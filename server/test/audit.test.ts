import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toIso2 } from "../src/core/normalize.ts";
import { reconcile } from "../src/core/reconcile.ts";
import { processShipment } from "../src/core/pipeline.ts";
import { assertShipment, extractShipment } from "../src/core/extract.ts";
import { isBlockingFinding } from "../src/core/readiness.ts";
import type { Shipment } from "../src/core/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sample = (): Shipment => JSON.parse(readFileSync(resolve(root, "fixtures/sample-shipment.json"), "utf8"));
const T = "2026-10-09";
const doc = [{ name: "x.pdf", data: Buffer.from("%PDF-1.4") }];
const stopBody = (payload: unknown) => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200 });

// ================= G: country codes =================
test("country codes: names/aliases normalise, UK -> GB, invalid stays unresolved", () => {
  for (const [inp, want] of [["Japan", "JP"], ["Germany", "DE"], ["Italy", "IT"], ["Malaysia", "MY"], ["South Korea", "KR"], ["Sri Lanka", "LK"], ["Bangladesh", "BD"], ["China", "CN"], ["United Kingdom", "GB"], ["UK", "GB"], ["uk", "GB"], ["US", "US"], ["vn", "VN"]] as [string, string][])
    assert.equal(toIso2(inp), want, inp);
  for (const bad of ["Narnia", "", "   ", "U", "ZZZ"]) assert.equal(toIso2(bad), undefined, bad);
  assert.equal(toIso2(undefined), undefined);
});

// ================= C: no fabricated header values =================
test("no fabricated header data: missing description and country-of-export evidence are omitted and flagged", async () => {
  const s = sample();
  delete s.bol.goodsDescription;
  s.bol.portOfLoading = undefined;
  const r = await processShipment(s, {}, T);
  assert.doesNotMatch(r.xml, /<description>/, "no defaulted goods description");
  assert.doesNotMatch(r.xml, /<country-export>/, "no defaulted country of export");
  assert.ok(r.missing.some((m) => m.field === "goods description"));
  assert.ok(r.missing.some((m) => m.field.startsWith("country-export for ")));
});

test("country of export is emitted only from per-line evidence", async () => {
  const s = sample();
  s.bol.portOfLoading = "SHEKOU, SHENZHEN, CN";
  s.invoice.lines[0].exportCountry = "CN";
  const r = await processShipment(s, {}, T);
  assert.match(r.xml, /<country-export>CN<\/country-export>/);
  assert.ok(r.missing.some((m) => m.field === "country-export for BP-H205"));
});

test("direct broker inputs cannot promote invalid HTSUS or line evidence into XML", async () => {
  const s = sample();
  const r = await processShipment(s, {
    htsByStyle: { L1: "610910" },
    lineEvidence: {
      L1: {
        manufacturerId: { value: "TOO-LONG-MANUFACTURER-ID", approved: true },
        countryOfExport: { value: "ZZ", approved: true },
      },
    },
  }, T);
  assert.match(r.xml, /<tariff-no>610910<\/tariff-no>/, "the document-stated HS fragment remains traceable, but is not promoted to a classification");
  assert.doesNotMatch(r.xml, /<manufacturer-id>TOO-LONG-MANUFACTURER-ID<\/manufacturer-id>/);
  assert.doesNotMatch(r.xml, /<country-export>ZZ<\/country-export>/);
  for (const field of ["HTSUS 10-digit for BP-T101", "manufacturer-id for BP-T101", "country-export for BP-T101"]) {
    assert.ok(r.missing.some((m) => m.field === field && m.blocking), field);
  }
  assert.equal(r.readyToFile, false);
  assert.ok(r.assumptions.some((a) => a.field === "HTSUS 10-digit for BP-T101" && a.status === "broker_confirm"));
  assert.ok(r.assumptions.some((a) => a.field === "manufacturer-id BP-T101" && a.status === "broker_confirm"));
  assert.ok(r.assumptions.some((a) => a.field === "country-export BP-T101" && a.status === "broker_confirm"));
});

// ================= H: XML integrity =================
test("XML integrity: control characters are stripped + flagged; over-length fields are flagged, not silently cut", async () => {
  const s = sample();
  s.bol.goodsDescription = "APPAREL\u0007 WITH BELL\u0000";
  s.bol.vessel = "V".repeat(30);
  s.bol.voyage = "1234567890";
  const r = await processShipment(s, {}, T);
  assert.doesNotMatch(r.xml, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/, "no invalid XML characters");
  assert.ok(r.findings.some((f) => f.code === "CONTROL_CHARS"));
  assert.ok(r.missing.some((m) => /vessel name/.test(m.field)));
  assert.ok(r.missing.some((m) => /voyage number/.test(m.field)));

  const s2 = sample(); s2.bol.goodsDescription = "D".repeat(80);
  const r2 = await processShipment(s2, {}, T);
  assert.ok(r2.missing.some((m) => /goods description/.test(m.field)), "long description flagged");
});

test("a filer code does not silently invent an entry number", async () => {
  const r = await processShipment(sample(), { filerCode: "ABC" }, T);
  assert.ok(r.assumptions.some((a) => a.field === "entry-no" && /placeholder|not a real/i.test(a.basis)));
  assert.ok(r.missing.some((m) => m.field === "entry number"));
});

test("assumptions response contains no blank derived values", async () => {
  const s = sample();
  delete s.invoice.shipTo!.state;
  delete s.bol.masterScac;
  delete s.invoice.lines[0].manufacturer;
  delete s.factory;
  const r = await processShipment(s, {}, T);

  assert.ok(r.assumptions.every((a) => a.field.trim() && a.value.trim() && a.basis.trim()));
  assert.ok(!r.assumptions.some((a) => a.field === "state-destination" || a.field === "carrier-code" || a.field === "manufacturer-id BP-T101"));
  assert.ok(r.missing.some((m) => m.field === "state-destination"));
  assert.ok(r.missing.some((m) => m.field === "carrier-code"));
  assert.ok(r.missing.some((m) => m.field === "manufacturer-id for BP-T101"));
});

// ================= I: logistics consistency =================
test("logistics: net>gross, ETA before on-board, and duplicate containers are blocking findings", () => {
  const s = sample();
  s.packing.netKg = 99999;
  s.bol.etaDate = "2026-01-01"; s.bol.onBoardDate = "2026-09-24";
  s.bol.containers = [{ number: "OPLU1041723", seal: "A" }, { number: "OPLU 1041723", seal: "B" }];
  const codes = reconcile(s).map((f) => f.code);
  for (const c of ["NET_GT_GROSS", "ETA_BEFORE_ONBOARD", "DUPLICATE_CONTAINER"]) {
    assert.ok(codes.includes(c), c);
    assert.equal(isBlockingFinding(c), true, c + " blocks");
  }
});

test("logistics: zero packages / zero gross weight are flagged, not emitted as verified", () => {
  const s = sample();
  s.bol.packages = 0; s.bol.grossKg = 0; s.packing.grossKg = 0;
  const codes = reconcile(s).map((f) => f.code);
  assert.ok(codes.includes("PACKAGES_ZERO"));
  assert.ok(codes.includes("GROSS_ZERO"));
});

// ================= E: packing list both directions =================
test("packing list: a style with no invoice line is flagged", () => {
  const s = sample();
  s.packing.lines.push({ style: "ZZ-999", pcs: 10 });
  assert.ok(reconcile(s).some((f) => f.code === "PL_STYLE_NOT_INVOICED"));
});

// ================= J: extraction robustness =================
test("extraction: transient 429 is retried; a permanent 400 is not", async () => {
  const real = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => { calls++; return calls === 1 ? new Response("{}", { status: 429, headers: { "retry-after": "0" } }) : stopBody(sample()); }) as typeof fetch;
  try { await extractShipment(doc, { apiKey: "k" }); assert.equal(calls, 2, "retried once after 429"); } finally { globalThis.fetch = real; }

  calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("{}", { status: 400 }); }) as typeof fetch;
  try { await assert.rejects(extractShipment(doc, { apiKey: "k" }), /HTTP 400/); assert.equal(calls, 1, "400 is not retried"); } finally { globalThis.fetch = real; }
});

test("extraction: a non-STOP finishReason fails loudly instead of parsing a truncated answer", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"invoice":{"number":"X"' }] } }] }), { status: 200 })) as typeof fetch;
  try { await assert.rejects(extractShipment(doc, { apiKey: "k" }), /finishReason: MAX_TOKENS/); } finally { globalThis.fetch = real; }
});

test("extraction: the model request uses neutral document labels, never the raw filename", async () => {
  const real = globalThis.fetch; let body: any;
  globalThis.fetch = (async (_u: unknown, init: any) => { body = JSON.parse(String(init?.body)); return stopBody(sample()); }) as typeof fetch;
  try {
    await extractShipment([{ name: "../../etc/passwd.pdf", data: Buffer.from("%PDF-1.4") }], { apiKey: "k" });
    const texts = body.contents[0].parts.filter((p: any) => p.text).map((p: any) => p.text).join(" ");
    assert.doesNotMatch(texts, /passwd/, "filename not injected");
    assert.match(texts, /Document 1 of 1/);
  } finally { globalThis.fetch = real; }
});

// ================= C: country of origin is never fabricated =================
test("origin: an unstated origin stays unknown, is flagged, blocks readiness, and emits no country-origin", async () => {
  const s = sample();
  delete s.invoice.lines[2].originCountry;
  assert.equal(s.invoice.lines[2].originCountry, undefined);
  const r = await processShipment(s, {}, T);
  assert.ok(r.findings.some((f) => f.code === "ORIGIN_MISSING"));
  assert.equal(isBlockingFinding("ORIGIN_MISSING"), true);
  assert.equal(r.readyToFile, false);
  assert.equal((r.xml.match(/<country-origin>/g) ?? []).length, 4, "the unknown line emits no country-origin");
  assert.ok(r.missing.some((m) => /country-of-origin/.test(m.field) && m.blocking));
});

test("origin: a model response that omits originCountry is not given a fabricated country", async () => {
  const real = globalThis.fetch;
  const payload = JSON.parse(JSON.stringify(sample()));
  delete payload.invoice.lines[2].originCountry;
  globalThis.fetch = (async () => stopBody(payload)) as typeof fetch;
  try {
    const s = await extractShipment(doc, { apiKey: "k" });
    assert.equal(s.invoice.lines[2].originCountry, undefined, "no inference from another line or the shipment");
    assert.equal(s.invoice.lines[0].originCountry, "VN", "stated origins survive");
  } finally { globalThis.fetch = real; }
});

test("origin: an empty or whitespace origin is treated as unknown, not as a country", () => {
  const s = sample() as any;
  s.invoice.lines[2].originCountry = "";
  s.invoice.lines[3].originCountry = "   ";
  const parsed = assertShipment(s);
  assert.equal(parsed.invoice.lines[2].originCountry, undefined);
  assert.equal(parsed.invoice.lines[3].originCountry, undefined);
});
