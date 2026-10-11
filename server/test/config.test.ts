import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODEL, extractShipment, isGeminiModelId, resolveModel } from "../src/core/extract.ts";
import { handleHealth } from "../src/api.ts";
import type { Shipment } from "../src/core/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const sample = (): Shipment => JSON.parse(readFileSync(resolve(root, "fixtures/sample-shipment.json"), "utf8"));
const doc = [{ name: "x.pdf", data: Buffer.from("%PDF-1.4") }];
const geminiResponse = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

test("default model is the documented Gemini Flash model", () => {
  assert.equal(DEFAULT_MODEL, "gemini-3.8-flash");
  assert.ok(isGeminiModelId(DEFAULT_MODEL));
  assert.notEqual(DEFAULT_MODEL, "gemini-3.8-flash-5");
});

test("resolveModel trims valid Gemini ids and falls back for invalid provider ids", () => {
  assert.equal(resolveModel("gemini-3.6-flash"), "gemini-3.6-flash");
  assert.equal(resolveModel(" gemini-2.5-flash-lite "), "gemini-2.5-flash-lite");
  for (const bad of [undefined, "", "   ", "flash", "claude-sonnet-5", "gpt-4", "your-model-here", "gemini-"]) {
    assert.equal(resolveModel(bad), DEFAULT_MODEL, `"${bad}" should fall back to the documented default`);
    assert.equal(isGeminiModelId(bad), false);
  }
});

test("extractShipment sends native PDF inline_data and the selected Gemini model", async () => {
  const realFetch = globalThis.fetch;
  const seen: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    seen.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: (init?.headers ?? {}) as Record<string, string> });
    return geminiResponse(JSON.stringify(sample()));
  }) as typeof fetch;
  try {
    await extractShipment(doc, { apiKey: "test-key-not-real" });
    await extractShipment(doc, { apiKey: "test-key-not-real", model: "gemini-3.6-flash" });
    await extractShipment(doc, { apiKey: "test-key-not-real", model: "claude-sonnet-5" });
    assert.deepEqual(seen.map((x) => x.body.generationConfig.responseMimeType), ["application/json", "application/json", "application/json"]);
    assert.deepEqual(seen.map((x) => new URL(x.url).pathname.split("/").at(-1)), ["gemini-3.8-flash:generateContent", "gemini-3.6-flash:generateContent", "gemini-3.8-flash:generateContent"]);
    assert.equal(seen[0].body.contents[0].parts[1].inline_data.mime_type, "application/pdf");
    assert.equal(seen[0].body.contents[0].parts[1].inline_data.data, doc[0].data.toString("base64"));
    assert.equal(new URL(seen[0].url).searchParams.get("key"), null, "the key must NOT be in the URL query string");
    assert.equal((seen as any).length, 3);
    assert.equal(seen[0].headers["x-goog-api-key"], "test-key-not-real", "the key is sent in the x-goog-api-key header");
  } finally { globalThis.fetch = realFetch; }
});

test("Gemini empty or malformed responses fail safely", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })) as typeof fetch;
    await assert.rejects(() => extractShipment(doc, { apiKey: "fake" }), /no extraction candidate/i);
    globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }), { status: 200 })) as typeof fetch;
    await assert.rejects(() => extractShipment(doc, { apiKey: "fake" }), /valid JSON/i);
  } finally { globalThis.fetch = realFetch; }
});

test("health reports effective Gemini model and whether extraction is configured", async () => {
  const withKey = await handleHealth({ apiKey: "test-key-not-real" });
  assert.equal(withKey.status, 200);
  assert.equal((withKey.body as any).extraction.configured, true);
  assert.equal((withKey.body as any).extraction.model, DEFAULT_MODEL);
  const withModel = await handleHealth({ apiKey: "test-key-not-real", model: "gemini-3.6-flash" });
  assert.equal((withModel.body as any).extraction.model, "gemini-3.6-flash");
  const withoutKey = await handleHealth({});
  assert.equal((withoutKey.body as any).extraction.configured, false);
  assert.equal((withoutKey.body as any).netchb.connected, false);
});

test("a missing key returns an actionable 503 and never calls the extractor", async () => {
  const { handleEntryUpload } = await import("../src/api.ts");
  let called = false;
  const r = await handleEntryUpload([{ name: "a.pdf", data: Buffer.from("%PDF-1.4") }], {}, { extract: async () => { called = true; return sample(); } });
  assert.equal(r.status, 503);
  assert.equal((r.body as any).code, "NO_API_KEY");
  assert.match((r.body as any).error, /GEMINI_API_KEY/);
  assert.equal(called, false);
});
