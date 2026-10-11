import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { processShipment } from "../src/core/pipeline.ts";
import { reconcile } from "../src/core/reconcile.ts";
import type { Shipment } from "../src/core/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sample = (): Shipment => JSON.parse(readFileSync(resolve(root, "fixtures/sample-shipment.json"), "utf8"));
const T = "2026-10-09";
const val = (xml: string, n: number) => [...xml.matchAll(/<value>([\d.]+)<\/value>/g)][n]?.[1];

// The exact figures the assignment calls out must hold, and the derived scenarios must stay deterministic.
test("assignment integrity values are preserved in the fixture and the source shipment", () => {
  const s = sample();
  const paid = s.invoice.lines.filter((l) => !l.isFreeOfCharge);
  const foc = s.invoice.lines.filter((l) => l.isFreeOfCharge);

  // invoice line 1
  const ts = s.invoice.lines.find((l) => l.style === "BP-T101")!;
  assert.deepEqual([ts.quantity, ts.unitPrice, ts.statedAmount], [2400, 2.85, 6480]);
  assert.equal(Math.round((ts.quantity * ts.unitPrice - ts.statedAmount) * 100) / 100, 360, "2,400 x 2.85 - 6,480 = 360");

  // buyer-supplied fabric assist, separate from the invoice amount
  const blouse = s.invoice.lines.find((l) => l.style === "W-B220")!;
  assert.equal(blouse.statedAmount, 1260);
  assert.equal(blouse.assistValue, 4180);

  // free-of-charge samples: 24 pcs, Bangladesh origin, USD 24 customs-purpose value
  assert.equal(foc.length, 1);
  assert.deepEqual([foc[0].quantity, foc[0].originCountry, foc[0].customsValue], [24, "BD", 24]);

  // printed invoice totals
  assert.deepEqual([s.invoice.statedFobTotal, s.invoice.freight, s.invoice.insurance, s.invoice.statedTotal], [23235, 3850, 185, 27270]);

  // packing list vs B/L
  assert.deepEqual([s.packing.cartons, s.packing.grossKg, s.packing.netKg, s.packing.cbm], [138, 1888, 1734.5, 13.58]);
  assert.equal(s.bol.packages, 138);
  assert.equal(s.bol.grossKg, 1930);
  assert.equal(paid.reduce((n, l) => n + l.quantity, 0), 5100, "5,100 commercial pieces");
});

test("entered-value scenarios are deterministic: 22,899 default, 27,439 with both suggestions", async () => {
  const def = await processShipment(sample(), {}, T);
  assert.equal(def.valuation.entered, 22899);
  assert.equal(def.valuation.enteredIfAllSuggestionsAccepted, 27439);
  assert.equal(def.valuation.pending, 2, "exactly the 360 correction and the 4,180 assist await approval");
  assert.equal(val(def.xml, 0), "6480.00", "printed T-shirt amount unchanged");
  assert.match(def.xml, /<total-entry-value>22899<\/total-entry-value>/);
  assert.notEqual(def.valuation.entered, 27270, "the CIF total is not the entered value");

  const all = await processShipment(sample(), { approvals: { acceptRecomputedAmounts: "all", acceptAssist: "all" } }, T);
  assert.equal(all.valuation.entered, 27439);
  assert.equal(val(all.xml, 0), "6840.00");
  assert.equal(val(all.xml, 3), "5440.00");
});

test("every planted discrepancy and every missing broker input is surfaced", () => {
  const s = sample();
  const codes = new Set(reconcile(s).map((f) => f.code));
  for (const c of ["LINE_AMOUNT", "QTY_MISMATCH", "QTY_HYPOTHESIS", "WEIGHT_MISMATCH", "CONTAINER_CORRECTED", "MIXED_ORIGIN", "FOC", "ASSIST", "INVOICE_NO_CHARS", "HTS10_MISSING"]) {
    assert.ok(codes.has(c), `expected finding ${c}`);
  }
  const qty = reconcile(s).find((f) => f.code === "QTY_MISMATCH")!;
  assert.match(qty.message, /BP-H205: invoice 1200 vs packing list 1176/);
  const wt = reconcile(s).find((f) => f.code === "WEIGHT_MISMATCH")!;
  assert.match(wt.message, /packing list 1888 kg vs B\/L 1930 kg/);
});

test("no identifier, classification or approval is invented", async () => {
  const r = await processShipment(sample(), {}, T);
  assert.doesNotMatch(r.xml, /<tariff-no>\d{10}</, "no 10-digit HTSUS unless a broker supplies it");
  assert.doesNotMatch(r.xml, /<importer-tax-id>/, "importer id is never guessed");
  assert.match(r.xml, /<processing-port>0000<\/processing-port>/, "processing port stays the visible sentinel");
  const blocking = r.missing.filter((m) => m.blocking).map((m) => m.field);
  for (const f of ["importer-tax-id", "processing-port", "surety-code / bond"]) assert.ok(blocking.includes(f), `blocking missing: ${f}`);
  assert.equal(r.readyToFile, false, "never declared ready while blocking inputs and assumptions remain");
  assert.match(r.readinessNote, /NOT ready to file/);
});
