import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handleEntryUpload, handleRegenerate, type ApiDeps } from "../src/api.ts";
import { buildEntryResponse } from "../src/contract.ts";
import { toFrontendShipment } from "../src/frontendShape.ts";
import { assertShipment, ExtractionInvalidError, stripBrokerOnlyFields } from "../src/core/extract.ts";
import { isIsoCountry, toIso2 } from "../src/core/normalize.ts";
import { signSource, verifySource } from "../src/core/sourceProof.ts";
import type { Shipment } from "../src/core/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const sample = (): Shipment => { const s = JSON.parse(readFileSync(resolve(here, "../../fixtures/sample-shipment.json"), "utf8")); delete s._provenance; return s; };
const TODAY = "2026-10-09";
const deps = (s: Shipment = sample()): ApiDeps => ({ apiKey: "k", extract: async () => s, today: () => TODAY });
const body = (r: { body: unknown }) => r.body as Record<string, any>;
const pdf = { name: "doc.pdf", data: Buffer.from("%PDF-1.4\n") };

// ---- /regenerate trust boundary
test("upload response carries a source proof and regenerate accepts exactly that source", async () => {
  const up = body(await handleEntryUpload([pdf], {}, deps()));
  assert.match(up["sourceProof"], /^[0-9a-f]{64}$/);
  const fe = up["shipment"]; fe.lines[0].description = "Edited description";
  const r = await handleRegenerate({ source: up["source"], sourceProof: up["sourceProof"], shipment: fe }, deps());
  assert.equal(r.status, 200);
  assert.ok(body(r)["edits"].some((e: any) => e.field === "description"), "broker edit is recorded as an edit, source stays verified");
  assert.equal(body(r)["source"].invoice.lines[0].description, sample().invoice.lines[0].description, "verified source is not overwritten by the edit");
});

test("regenerate rejects a source with no proof, a forged proof, or a tampered source", async () => {
  const source = sample(), fe = toFrontendShipment(source);
  const none = await handleRegenerate({ source, shipment: fe }, deps());
  assert.equal(none.status, 403); assert.equal(body(none)["code"], "SOURCE_UNVERIFIED");
  const forged = await handleRegenerate({ source, sourceProof: "0".repeat(64), shipment: fe }, deps());
  assert.equal(forged.status, 403);
  const proof = signSource(source);
  const tampered = structuredClone(source); tampered.invoice.lines[0]!.statedAmount += 1000;
  const t = await handleRegenerate({ source: tampered, sourceProof: proof, shipment: toFrontendShipment(tampered) }, deps());
  assert.equal(t.status, 403, "a changed printed amount must not pass as verified extraction");
  const fabricated = structuredClone(source); fabricated.invoice.lines.push({ ...fabricated.invoice.lines[0]!, id: "FAKE", lineNo: 99, style: "FAKE", addedByBroker: true });
  assert.equal((await handleRegenerate({ source: fabricated, sourceProof: proof, shipment: toFrontendShipment(fabricated) }, deps())).status, 403);
});

test("source proof survives a JSON round trip and key reordering, and fails on any value change", () => {
  const s = sample(), p = signSource(s);
  assert.equal(verifySource(JSON.parse(JSON.stringify(s)), p), true);
  assert.equal(verifySource({ ...s, invoice: { ...s.invoice, number: s.invoice.number + "X" } }, p), false);
  assert.equal(verifySource(s, undefined), false);
});

test("model output can never claim broker-only fields", () => {
  const s = sample(); s.invoice.lines[0]!.amountOverride = 1; s.invoice.lines[0]!.addedByBroker = true;
  const clean = stripBrokerOnlyFields(s).invoice.lines[0]!;
  assert.equal(clean.amountOverride, undefined); assert.equal(clean.addedByBroker, undefined);
});

// ---- country codes
test("ISO country codes: assigned codes only; unassigned two-letter strings are rejected", () => {
  assert.equal(toIso2("ZZ"), undefined); assert.equal(toIso2("XX"), undefined); assert.equal(isIsoCountry("QQ"), false);
  assert.equal(toIso2("vn"), "VN"); assert.equal(toIso2("UK"), "GB"); assert.equal(toIso2("Vietnam"), "VN"); assert.equal(isIsoCountry("US"), true);
  const bad = sample(); (bad.invoice.lines[0] as any).originCountry = "ZZ";
  assert.throws(() => assertShipment(bad), (e: unknown) => e instanceof ExtractionInvalidError && /ISO/.test((e as Error).message));
  const lower = sample(); (lower.invoice.lines[0] as any).originCountry = "Vietnam";
  assert.equal(assertShipment(lower).invoice.lines[0]!.originCountry, "VN");
});

// ---- foreign currency and truncation are blocking
test("foreign currency without a verified rate blocks readiness with a clear finding", async () => {
  const s = sample(); s.invoice.currency = "EUR";
  const r = await buildEntryResponse(s, { today: TODAY });
  assert.equal(r.readiness.readyToFile, false);
  const f = r.findings.find((x) => /exchange rate/.test(x.title));
  assert.ok(f && f.severity === "missing" && /Missing before filing/.test(f.title), "blocking finding is shown");
  assert.match(f!.description, /UNCONVERTED EUR/);
  assert.ok(r.missing.find((m) => m.field === "exchange rate")?.blocking);
});

test("USD invoices do not get an exchange-rate blocker", async () => {
  const r = await buildEntryResponse(sample(), { today: TODAY });
  assert.equal(r.missing.some((m) => m.field === "exchange rate"), false);
});

test("over-length schema fields are blocking findings, not silent truncation", async () => {
  const s = sample(); s.bol.vessel = "V".repeat(25); s.bol.voyage = "123456789"; s.bol.goodsDescription = "G".repeat(90);
  const r = await buildEntryResponse(s, { today: TODAY });
  for (const field of ["vessel name", "voyage number", "goods description"]) {
    const m = r.missing.find((x) => x.field === field && /characters but/.test(x.why));
    assert.ok(m, `${field} flagged`); assert.equal(m!.blocking, true, `${field} blocks`);
  }
  assert.equal(r.readiness.readyToFile, false);
});
