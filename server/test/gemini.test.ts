import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractShipment } from "../src/core/extract.ts";
import { cleanContainerNumber, normalizeContainerSize } from "../src/core/normalize.ts";
import { processShipment } from "../src/core/pipeline.ts";
import type { Shipment } from "../src/core/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sample = (): Shipment => JSON.parse(readFileSync(resolve(root, "fixtures/sample-shipment.json"), "utf8"));
const doc = [{ name: "x.pdf", data: Buffer.from("%PDF-1.4") }];

// Regression for a real bug found with live Gemini extraction: default "thinking" was billed against
// maxOutputTokens and truncated the JSON (finishReason MAX_TOKENS). Gemini 3 models accept a thinking
// cap; Gemini 2.5 models reject `thinkingLevel`, so it must only be sent for Gemini 3.
test("Gemini 3 requests cap thinking and use a generous output budget; Gemini 2.5 requests omit thinkingLevel", async () => {
  const real = globalThis.fetch;
  const seen: any[] = [];
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    seen.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(sample()) }] } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    await extractShipment(doc, { apiKey: "test-key-not-real" });
    await extractShipment(doc, { apiKey: "test-key-not-real", model: "gemini-2.5-flash" });
    const [g3, g25] = seen.map((b) => b.generationConfig);
    assert.equal(g3.responseMimeType, "application/json");
    assert.ok(g3.maxOutputTokens >= 32000, "budget must leave room for the JSON after thinking");
    assert.deepEqual(g3.thinkingConfig, { thinkingLevel: "low" });
    assert.equal(g25.thinkingConfig, undefined, "gemini-2.5 rejects thinkingLevel and would 400");
    assert.ok(g25.maxOutputTokens >= 32000);
    // the PDF is sent as native inline_data (so scanned pages work, not just the text layer)
    assert.equal(seen[0].contents[0].parts[1].inline_data.mime_type, "application/pdf");
  } finally { globalThis.fetch = real; }
});

test("container size and number are normalised to what entry.xsd accepts", () => {
  assert.equal(normalizeContainerSize("20'GP"), "20 ft");
  assert.equal(normalizeContainerSize("20GP"), "20 ft");
  assert.equal(normalizeContainerSize("40HC"), "40 ft HC");
  assert.equal(normalizeContainerSize("45' High Cube"), "45 ft HC");
  assert.equal(normalizeContainerSize("20 ft"), "20 ft");
  assert.equal(normalizeContainerSize("53"), "53 ft");
  assert.equal(normalizeContainerSize("refrigerated"), undefined, "unknown sizes are omitted, not emitted");
  assert.equal(normalizeContainerSize(undefined), undefined);
  assert.equal(cleanContainerNumber("OPLU 104172 3"), "OPLU1041723");
});

test("XML generated from a live-style container size/number is schema-valid", async () => {
  const s = sample();
  s.bol.containers = [{ number: "OPLU 104172 3", size: "20'GP", seal: "EXL7731482", printedNumber: "OPLU1041726" }];
  const r = await processShipment(s, {}, "2026-10-11");
  assert.match(r.xml, /<container-size>20 ft<\/container-size>/);
  assert.match(r.xml, /<container-number>OPLU1041723<\/container-number>/);
  assert.equal(r.validation.valid, true, r.validation.errors.join("\n"));
});

// Opt-in live test: a real Gemini request against the three sample PDFs. Skipped unless
// SEFER_LIVE_GEMINI=1 and GEMINI_API_KEY are set (needs network egress + a valid key + the PDFs).
const liveDir = process.env["SEFER_SAMPLE_PDFS"] ?? "";
const liveReady = process.env["SEFER_LIVE_GEMINI"] === "1" && !!process.env["GEMINI_API_KEY"] && !!liveDir && existsSync(liveDir);
test("live Gemini extraction of the three real PDFs (opt-in)", { skip: liveReady ? false : "set SEFER_LIVE_GEMINI=1, GEMINI_API_KEY and SEFER_SAMPLE_PDFS" }, async () => {
  const names = readdirSync(liveDir).filter((f: string) => /\.pdf$/i.test(f));
  const docs = names.map((n: string) => ({ name: n, data: readFileSync(resolve(liveDir, n)) }));
  const s = await extractShipment(docs, { apiKey: process.env["GEMINI_API_KEY"] as string });
  assert.equal(s.invoice.lines[0].statedAmount, 6480, "printed T-shirt amount preserved");
  assert.equal(s.invoice.lines[0].quantity, 2400);
  assert.equal(s.invoice.statedFobTotal, 23235);
  assert.equal(s.invoice.statedTotal, 27270);
  const r = await processShipment(s, {}, "2026-10-11");
  assert.equal(r.valuation.entered, 22899);
  assert.equal(r.validation.valid, true, r.validation.errors.join("\n"));
});
