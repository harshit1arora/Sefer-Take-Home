import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { processShipment } from "../src/core/pipeline.ts";
import { reconcile, iso6346Valid } from "../src/core/reconcile.ts";
import { buildMid } from "../src/core/mid.ts";
import { parseDocDate, sanitizeInvoiceNo, splitBill, usPort } from "../src/core/normalize.ts";
import { validateXml } from "../src/core/validate.ts";
import { assertShipment } from "../src/core/extract.ts";
import type { Shipment } from "../src/core/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const sample = (): Shipment => JSON.parse(readFileSync(resolve(here, "../../fixtures/sample-shipment.json"), "utf8"));
const codes = (s: Shipment) => reconcile(s).map((f) => f.code);
const TODAY = "2026-10-09";

test("ISO 6346: handwritten container is valid, printed one is not", () => {
  assert.equal(iso6346Valid("OPLU1041723"), true);
  assert.equal(iso6346Valid("OPLU1041726"), false);
});

test("sample shipment: reconciliation finds every planted discrepancy", () => {
  const c = codes(sample());
  for (const want of ["LINE_AMOUNT", "QTY_MISMATCH", "QTY_HYPOTHESIS", "WEIGHT_MISMATCH", "MIXED_ORIGIN", "ASSIST", "FOC", "INVOICE_NO_CHARS", "HTS10_MISSING", "CIF_DEDUCT", "INVOICE_TOTAL_OK"])
    assert.ok(c.includes(want), `missing finding ${want}; got ${c.join(",")}`);
  assert.ok(!c.includes("CONTAINER_CHECK"), "corrected container must pass");
  assert.ok(!c.includes("PKG_MISMATCH"));
  assert.equal(c.filter((x) => x === "HTS10_MISSING").length, 5);
});

test("sample shipment: printed (wrong) container number is flagged", () => {
  const s = sample(); s.bol.containers[0].number = "OPLU1041726";
  assert.ok(codes(s).includes("CONTAINER_CHECK"));
});

test("sample shipment: values, totals and XML content", async () => {
  const r = await processShipment(sample(), {}, TODAY);
  // default = printed source amounts only; suggestions (T-shirt delta, assist) are NOT included until approved
  assert.deepEqual(r.totals.byLine.map((x) => x.value), [6480, 8880, 6255, 1260, 24]);
  assert.equal(r.totals.entered, 22899);
  assert.match(r.xml, /<invoice-no>HLAS-BP-26-0912<\/invoice-no>/);
  assert.match(r.xml, /<country-origin>BD<\/country-origin>/);
  assert.match(r.xml, /<manufacturer-id>BDEXAGAR41GAZ<\/manufacturer-id>/);
  assert.match(r.xml, /<unlading-port>3002<\/unlading-port>/);
  assert.match(r.xml, /<container-number>OPLU1041723<\/container-number>/);
  assert.doesNotMatch(r.xml, /27270/, "CIF total must not be the entered value");
});

test("sample shipment: XSD-valid but NOT declared ready to file", async () => {
  const r = await processShipment(sample(), {}, TODAY);
  assert.equal(r.validation.valid, true, r.validation.errors.join("\n"));
  assert.equal(r.readyToFile, false);
  assert.ok(r.missing.some((m) => m.field === "importer-tax-id" && m.blocking));
  assert.ok(r.missing.some((m) => m.field === "processing-port" && m.blocking));
  assert.ok(r.missing.filter((m) => m.field.startsWith("HTSUS")).length === 5);
});

test("validator is real: raw invoice number with slashes is rejected", async () => {
  const r = await processShipment(sample(), {}, TODAY);
  const bad = r.xml.replace("HLAS-BP-26-0912", "HLAS/BP/26-0912");
  const v = await validateXml(bad);
  assert.equal(v.valid, false);
  assert.match(v.errors.join("\n"), /invoice-no/);
});

test("validator is real: wrong element order / bad port / missing required element fail", async () => {
  const r = await processShipment(sample(), {}, TODAY);
  assert.equal((await validateXml(r.xml.replace("<entry-port>3002", "<entry-port>30"))).valid, false);
  assert.equal((await validateXml(r.xml.replace(/<entry-type>01<\/entry-type>/, ""))).valid, false);
  assert.equal((await validateXml(r.xml.replace(/<header>[\s\S]*<\/header>\s*(<manifest>)/, "$1"))).valid, false);
});

test("MID construction (19 CFR Part 102 Appendix)", () => {
  assert.equal(buildMid({ name: "Mekong Garment JSC", address1: "Lot C7-C8, Road No. 9", city: "Di An", country: "VN" }).mid, "VNMEKGAR9DIA");
  assert.equal(buildMid({ name: "Acme Textile Co", address1: "1234 Main St", city: "Dhaka", country: "Bangladesh" }).mid, "BDACMTEX1234DHA");
});

test("date disambiguation uses the B/L date", () => {
  assert.deepEqual(parseDocDate("12/09/2026", { notAfter: "2026-09-24" }), { iso: "2026-09-12", ambiguous: false });
  assert.deepEqual(parseDocDate("25/09/2026"), { iso: "2026-09-25", ambiguous: false });
  assert.equal(parseDocDate("03/04/2026").ambiguous, true);
});

test("normalisation helpers", () => {
  assert.equal(sanitizeInvoiceNo("HLAS/BP/26-0912").value, "HLAS-BP-26-0912");
  assert.equal(sanitizeInvoiceNo("INV 2026 / 000000000000001").value.length <= 17, true);
  assert.deepEqual(splitBill("OPLU", "OPLUSGN26090001"), { scac: "OPLU", number: "SGN26090001" });
  assert.equal(usPort("TACOMA, WA, U.S.A.")?.code, "3002");
});

// ---------- synthetic variants (documents the app has never seen) ----------
test("variant: single origin, EUR invoice, no assist, no samples -> clean reconcile, foreign-currency emitted", async () => {
  const s = sample();
  s.invoice.lines = s.invoice.lines.slice(0, 3);
  s.invoice.lines[1].quantity = 1176; s.invoice.currency = "EUR";
  s.invoice.lines = s.invoice.lines.map((l) => ({ ...l, statedAmount: Math.round(l.quantity * l.unitPrice * 100) / 100 }));
  s.invoice.freight = undefined; s.invoice.insurance = undefined; s.invoice.statedTotal = undefined; s.invoice.incoterm = "FOB";
  s.packing.lines = s.packing.lines.slice(0, 3); s.packing.cartons = 138; s.bol.grossKg = 1888;
  const c = codes(s);
  for (const bad of ["LINE_AMOUNT", "QTY_MISMATCH", "WEIGHT_MISMATCH", "MIXED_ORIGIN", "ASSIST", "FOC"]) assert.ok(!c.includes(bad), `unexpected ${bad}`);
  const r = await processShipment(s, {}, TODAY);
  assert.match(r.xml, /<foreign-currency><currency-code>EUR<\/currency-code><\/foreign-currency>/);
  assert.equal(r.validation.valid, true, r.validation.errors.join("\n"));
  assert.ok(r.missing.some((m) => m.field === "exchange rate"));
});

test("variant: missing container + broker-supplied inputs flow through and validate", async () => {
  const s = sample(); s.bol.containers = [];
  assert.ok(codes(s).includes("NO_CONTAINER"));
  const broker = { processingPort: "3001", importerTaxId: "12-3456789", suretyCode: "999", filerCode: "ABC",
    htsByStyle: { "BP-T101": "6109100012" } };
  const r = await processShipment(s, broker, TODAY);
  assert.match(r.xml, /<importer-tax-id>12-3456789<\/importer-tax-id>/);
  assert.match(r.xml, /<tariff-no>6109100012<\/tariff-no>/);
  assert.match(r.xml, /<processing-port>3001<\/processing-port>/);
  assert.ok(!r.missing.some((m) => m.field === "importer-tax-id"));
  assert.equal(r.totals.byLine[3].value, 1260, "assist excluded unless approved");
  assert.equal(r.validation.valid, true, r.validation.errors.join("\n"));
});

test("variant: quantity mismatch without samples gives no hoodie hypothesis", () => {
  const s = sample(); s.invoice.lines = s.invoice.lines.filter((l) => !l.isFreeOfCharge); s.packing.lines = s.packing.lines.filter((l) => l.style !== "BP-P118S");
  const c = codes(s); assert.ok(c.includes("QTY_MISMATCH")); assert.ok(!c.includes("QTY_HYPOTHESIS"));
});

test("extraction output validation fails loudly on malformed model JSON", () => {
  assert.throws(() => assertShipment({}), /Extraction invalid/);
  const bad = sample() as any; bad.invoice.date = "12/09/2026";
  assert.throws(() => assertShipment(bad), /ISO/);
});
