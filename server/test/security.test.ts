import { test } from "node:test";
import assert from "node:assert/strict";
import { safeName, checkPdf, UploadError, MAX_FILE_BYTES } from "../src/core/extract.ts";
import { handleEntryUpload, handleHealth } from "../src/api.ts";

// ---------- filename handling: no path separators, bounded length ----------
test("upload filenames are sanitised so no path separator or traversal reaches the app", () => {
  for (const raw of ["../../etc/passwd", "..\\..\\windows\\win.ini", "/abs/path/x.pdf", "a/b/c.pdf", "tab\tname.pdf", "nul\u0000byte.pdf"]) {
    const n = safeName(raw);
    assert.doesNotMatch(n, /[\\/]/, `"${raw}" -> "${n}" must not contain a separator`);
    assert.ok(n.length <= 120);
  }
});

// ---------- upload validation: content, not just extension ----------
test("non-PDF, empty and oversize uploads are rejected with the right status", () => {
  assert.throws(() => checkPdf("evil.pdf", Buffer.from("MZ\u0090\u0000")), (e) => e instanceof UploadError && e.status === 415);
  assert.throws(() => checkPdf("empty.pdf", Buffer.alloc(0)), (e) => e instanceof UploadError && /empty/i.test(e.message));
  assert.throws(() => checkPdf("big.pdf", Buffer.alloc(MAX_FILE_BYTES + 1, 0x25)), (e) => e instanceof UploadError && e.status === 413);
  assert.equal(checkPdf("good.pdf", Buffer.from("%PDF-1.7\n")).name, "good.pdf");
});

// ---------- secrets never leak into a response ----------
test("the API key never appears in any response body, including errors", async () => {
  const key = "fake-gemini-key-not-real-xyz";
  const docs = [{ name: "a.pdf", data: Buffer.from("%PDF-1.4") }];
  const cases = [
    await handleEntryUpload(docs, {}, { apiKey: key, extract: async () => { throw new Error(`boom with ${key}`); } }),
    await handleEntryUpload(docs, {}, { apiKey: key, extract: async () => { throw new UploadError("provider said no", 502); } }),
    await handleHealth({ apiKey: key }),
  ];
  for (const r of cases) assert.ok(!JSON.stringify(r.body).includes(key), "response body must not contain the key");
});

// ---------- model output is data, not markup ----------
test("markup in an edited field is XML-escaped in the generated entry", async () => {
  const { buildEntryResponse } = await import("../src/contract.ts");
  const { toFrontendShipment } = await import("../src/frontendShape.ts");
  const { readFileSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const source = JSON.parse(readFileSync(resolve(root, "fixtures/sample-shipment.json"), "utf8"));
  const edited = toFrontendShipment(source);
  edited.lines[0].description = '<script>alert("x")</script> & "quotes"';
  const res = await buildEntryResponse(source, { edited, today: "2026-10-09" });
  assert.match(res.xml, /&lt;script&gt;/);
  assert.doesNotMatch(res.xml, /<script>alert/);
});
