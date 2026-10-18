import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { processShipment } from "../src/core/pipeline.ts";
import { computeValuation } from "../src/core/valuation.ts";
import { reconcile } from "../src/core/reconcile.ts";
import { validateXml } from "../src/core/validate.ts";
import { assertShipment, extractShipment } from "../src/core/extract.ts";
import type { Shipment } from "../src/core/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");  // repo root
const sample = (): Shipment => JSON.parse(readFileSync(resolve(root, "fixtures/sample-shipment.json"), "utf8"));
const T = "2026-10-09";
const valueOf = (xml: string, n: number) => [...xml.matchAll(/<value>([\d.]+)<\/value>/g)][n]?.[1];

// ---------- 1. source-value integrity ----------
test("source values are preserved: T-shirt printed amount stays 6480.00 end to end", async () => {
  const before = JSON.stringify(sample());
  const s = sample();
  const r = await processShipment(s, {}, T);
  assert.equal(JSON.stringify(s), before, "pipeline must not mutate extracted shipment");
  assert.equal(r.shipment.invoice.lines[0].statedAmount, 6480);
  assert.equal(valueOf(r.xml, 0), "6480.00");
  const comps = r.valuation.lines[0].components;
  assert.deepEqual(comps.map((c) => [c.id, c.amount, c.provenance, c.included]),
    [["invoice-amount", 6480, "source", true], ["recomputed-delta", 360, "suggested", false]]);
});

test("LINE_AMOUNT finding cites evidence, offers the alternative reading and does not overstate", () => {
  const f = reconcile(sample()).find((x) => x.code === "LINE_AMOUNT")!;
  assert.match(f.message, /printed amount 6480\.00/);
  assert.match(f.message, /SUGGESTED/);
  assert.match(f.message, /FOB total \(23235\.00\)/);
  assert.match(f.message, /unit price of 2\.7/);
  assert.doesNotMatch(f.message, /typo/i);
  const ok = reconcile(sample()).find((x) => x.code === "INVOICE_TOTAL_OK")!;
  assert.doesNotMatch(ok.message, /typo/i);
});

test("without the invoice's own totals the finding says no other figure resolves it", () => {
  const s = sample(); s.invoice.statedFobTotal = undefined;
  const f = reconcile(s).find((x) => x.code === "LINE_AMOUNT")!;
  assert.match(f.message, /No other figure on the invoice resolves it/);
});

// ---------- 2. approvals ----------
test("approving the recomputed amount for one style changes only that style, with provenance", async () => {
  const r = await processShipment(sample(), { approvals: { acceptRecomputedAmounts: ["L1"] } }, T);
  assert.deepEqual(r.totals.byLine.map((x) => x.value), [6840, 8880, 6255, 1260, 24]);
  assert.equal(r.totals.entered, 23259);
  assert.equal(r.valuation.lines[0].components[1].provenance, "broker_approved");
  assert.ok(r.assumptions.some((a) => a.field === "value L1: recomputed-delta" && a.status === "broker_approved"));
});

// ---------- 3. assist ----------
test("assist stays separate from the invoice amount and is excluded until approved", async () => {
  const r = await processShipment(sample(), {}, T);
  const blouse = r.valuation.lines[3];
  assert.equal(blouse.components[0].amount, 1260);
  assert.deepEqual(blouse.components[1], { ...blouse.components[1], id: "assist", amount: 4180, provenance: "suggested", included: false });
  assert.equal(blouse.value, 1260);
  assert.equal(valueOf(r.xml, 3), "1260.00");
  assert.ok(r.assumptions.some((a) => a.field === "value L4: assist" && a.status === "broker_confirm" && /NOT in the entered value/.test(a.basis)));
  const a = await processShipment(sample(), { approvals: { acceptAssist: ["L4"] } }, T);
  assert.equal(a.valuation.lines[3].value, 5440);
  assert.equal(valueOf(a.xml, 3), "5440.00");
  assert.equal(a.shipment.invoice.lines[3].statedAmount, 1260, "invoice amount untouched by assist approval");
});

// ---------- 4. entry value ----------
test("entered value is exactly the sum of included components; freight/insurance excluded", async () => {
  const r = await processShipment(sample(), {}, T);
  const v = r.valuation;
  for (const l of v.lines) assert.equal(l.value, Math.round(l.components.filter((c) => c.included).reduce((n, c) => n + c.amount, 0) * 100) / 100);
  assert.equal(v.entered, v.lines.reduce((n, l) => n + l.value, 0));
  assert.equal(v.entered, 22899);
  assert.equal(v.enteredIfAllSuggestionsAccepted, 27439);
  assert.equal(v.pending, 2);
  assert.deepEqual(v.excluded.map((x) => x.amount), [3850, 185]);
  assert.match(r.xml, /<total-entry-value>22899<\/total-entry-value>/);
  assert.notEqual(v.entered, 27270, "CIF total is not the entered value");
  const all = await processShipment(sample(), { approvals: { acceptRecomputedAmounts: "all", acceptAssist: "all" } }, T);
  assert.equal(all.valuation.entered, 27439);
  assert.equal(all.valuation.pending, 0);
});

test("free-of-charge samples are entered at the printed customs value, as a source component", () => {
  const v = computeValuation(sample());
  const foc = v.lines[4];
  assert.equal(foc.value, 24);
  assert.equal(foc.components[0].provenance, "source");
});

// ---------- 5. missing fields and readiness ----------
test("missing broker inputs are listed, blocking, and visible in the XML", async () => {
  const r = await processShipment(sample(), {}, T);
  const blocking = r.missing.filter((m) => m.blocking).map((m) => m.field);
  for (const f of ["importer-tax-id", "processing-port", "surety-code / bond", "HTSUS 10-digit for BP-T101", "HTSUS 10-digit for BP-P118S"]) assert.ok(blocking.includes(f), `missing ${f}`);
  assert.doesNotMatch(r.xml, /<importer-tax-id>/);
  assert.match(r.xml, /<!-- importer-tax-id missing/);
  assert.match(r.xml, /<processing-port>0000<\/processing-port>/);
  assert.match(r.readinessNote, /NOT ready to file/);
});

test("even with every broker input and approval, ready stays false while assumptions remain", async () => {
  const hts = { "L1": "6109100012", "L2": "6110203079", "L3": "6203424011", "L4": "6206400030", "L5": "6106100010" };
  const r = await processShipment(sample(), { importerTaxId: "12-3456789", processingPort: "3001", suretyCode: "999", entryType: "01", entryPort: "3002",
    locationOfGoods: "T123", htsByStyle: hts, approvals: { acceptRecomputedAmounts: "all", acceptAssist: "all" } }, T);
  assert.equal(r.validation.valid, true, r.validation.errors.join("\n"));
  assert.equal(r.missing.filter((m) => m.blocking).length, 0);
  assert.equal(r.readyToFile, false, "assumed fields (mode, SCAC split, charges...) and document errors remain");
});

// ---------- 6. malformed extraction output ----------
test("assertShipment rejects structurally wrong extraction output", () => {
  const bad = (mut: (s: any) => void, re: RegExp) => { const s: any = sample(); mut(s); assert.throws(() => assertShipment(s), re); };
  bad((s) => { s.invoice.lines = []; }, /invoice\.lines/);
  bad((s) => { delete s.invoice; }, /invoice/);
  bad((s) => { s.invoice.date = "12/09/2026"; }, /ISO/);
  bad((s) => { s.invoice.lines[0].quantity = "2,400"; }, /quantity/);
  bad((s) => { s.invoice.lines[0].originCountry = "Atlantis"; }, /originCountry/);
  bad((s) => { s.bol.containers = "OPLU1041723"; }, /bol\.containers/);
  bad((s) => { delete s.packing; }, /packing/);
});

test("extractShipment (mocked Gemini reply) fails loudly on prose / bad JSON and accepts fenced valid JSON", async () => {
  const realFetch = globalThis.fetch;
  const reply = (text: string) => (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 })) as typeof fetch;
  const doc = [{ name: "x.pdf", data: Buffer.from("%PDF-1.4") }];
  try {
    globalThis.fetch = reply("Here is the data you asked for: {oops");
    await assert.rejects(extractShipment(doc, { apiKey: "test-key-not-real" }), /valid JSON/);
    globalThis.fetch = reply(JSON.stringify({ invoice: { number: "X", date: "2026-01-01", lines: [{ lineNo: 1, quantity: "5", unitPrice: 1, originCountry: "VN" }] }, packing: { lines: [] }, bol: { houseBill: "H", containers: [] } }));
    await assert.rejects(extractShipment(doc, { apiKey: "test-key-not-real" }), /Extraction invalid/);
    globalThis.fetch = reply("```json\n" + JSON.stringify(sample()) + "\n```");
    const s = await extractShipment(doc, { apiKey: "test-key-not-real" });
    assert.equal(s.invoice.lines[0].statedAmount, 6480);
    // provider error statuses surface with an actionable hint and never echo the body
    globalThis.fetch = (async () => new Response("nope", { status: 401 })) as typeof fetch;
    await assert.rejects(extractShipment(doc, { apiKey: "test-key-not-real" }), /HTTP 401/);
    globalThis.fetch = (async () => new Response("{}", { status: 429 })) as typeof fetch;
    await assert.rejects(extractShipment(doc, { apiKey: "test-key-not-real" }), /HTTP 429/);
    globalThis.fetch = (async () => new Response("{}", { status: 403 })) as typeof fetch;
    await assert.rejects(extractShipment(doc, { apiKey: "test-key-not-real" }), /HTTP 403/);
    // malformed Gemini shapes
    globalThis.fetch = (async () => new Response("not-json", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    await assert.rejects(extractShipment(doc, { apiKey: "test-key-not-real" }), /unreadable response/);
    globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })) as typeof fetch;
    await assert.rejects(extractShipment(doc, { apiKey: "test-key-not-real" }), /no extraction candidate/);
    globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ content: {} }] }), { status: 200 })) as typeof fetch;
    await assert.rejects(extractShipment(doc, { apiKey: "test-key-not-real" }), /unexpected content format/);
    globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "   " }] } }] }), { status: 200 })) as typeof fetch;
    await assert.rejects(extractShipment(doc, { apiKey: "test-key-not-real" }), /no text to parse/);
  } finally { globalThis.fetch = realFetch; }
});

// ---------- 7. invalid XML ----------
test("schema validation rejects each class of invalid XML", async () => {
  const r = await processShipment(sample(), {}, T);
  const cases: [string, string, string][] = [
    ["entry-type", r.xml.replace("<entry-type>01<", "<entry-type>99<"), "entry-type"],
    ["5-digit port", r.xml.replace("<unlading-port>3002<", "<unlading-port>30020<"), "unlading-port"],
    ["short tariff", r.xml.replace("<tariff-no>610910<", "<tariff-no>6109<"), "tariff-no"],
    ["3-decimal value", r.xml.replace("<value>6480.00<", "<value>6480.001<"), "value"],
    ["bad state", r.xml.replace("<state-destination>WA<", "<state-destination>ZZ<"), "state-destination"],
    ["bad mode", r.xml.replace("<mode-transportation>11<", "<mode-transportation>99<"), "mode-transportation"],
    ["container size", r.xml.replace("<container-size>20 ft<", "<container-size>20 feet<"), "container-size"],
    ["invoice no", r.xml.replace("HLAS-BP-26-0912", "HLAS/BP/26-0912"), "invoice-no"],
    ["unknown element", r.xml.replace("<header>", "<header><bogus>1</bogus>"), "bogus"],
  ];
  for (const [name, xml, needle] of cases) {
    const v = await validateXml(xml);
    assert.equal(v.valid, false, `${name} should be invalid`);
    assert.match(v.errors.join("\n"), new RegExp(needle), name);
  }
  const broken = await validateXml(r.xml.replace("</header>", ""));
  assert.equal(broken.valid, false, "not well-formed XML must fail");
});

test("validation result states whether the full schema was used", async () => {
  const r = await processShipment(sample(), {}, T);
  const official = existsSync(resolve(root, "schemas/official/entry.xsd"));
  assert.equal(r.validation.schema, official ? "official" : "subset");
  assert.equal(r.validation.complete, official);
  assert.match(r.validation.note, official ? /official schema files/ : /BUNDLED SUBSET/);
  assert.match(r.validation.note, /never means|does not mean/);
});

// ---------- 9. invoice totals with absent freight/insurance & unit compatibility ----------
test("invoice statedTotal validation with neither component, freight only, insurance only, both, and mismatch", () => {
  // 1. Neither freight nor insurance present: statedTotal = statedFobTotal
  const s1 = sample();
  delete s1.invoice.freight;
  delete s1.invoice.insurance;
  s1.invoice.statedTotal = s1.invoice.statedFobTotal;
  const okNeither = reconcile(s1).find((x) => x.code === "INVOICE_TOTAL_OK");
  assert.ok(okNeither, "should find INVOICE_TOTAL_OK when neither freight nor insurance is present");

  // 2. Freight only: statedTotal = statedFobTotal + freight
  const s2 = sample();
  s2.invoice.freight = 1500;
  delete s2.invoice.insurance;
  s2.invoice.statedTotal = (s2.invoice.statedFobTotal ?? 0) + 1500;
  const okFreight = reconcile(s2).find((x) => x.code === "INVOICE_TOTAL_OK");
  assert.ok(okFreight, "should find INVOICE_TOTAL_OK when freight only is present");

  // 3. Insurance only: statedTotal = statedFobTotal + insurance
  const s3 = sample();
  delete s3.invoice.freight;
  s3.invoice.insurance = 250;
  s3.invoice.statedTotal = (s3.invoice.statedFobTotal ?? 0) + 250;
  const okInsurance = reconcile(s3).find((x) => x.code === "INVOICE_TOTAL_OK");
  assert.ok(okInsurance, "should find INVOICE_TOTAL_OK when insurance only is present");

  // 4. Both components present: statedTotal = statedFobTotal + freight + insurance
  const s4 = sample();
  s4.invoice.freight = 3850;
  s4.invoice.insurance = 185;
  s4.invoice.statedTotal = (s4.invoice.statedFobTotal ?? 0) + 3850 + 185;
  const okBoth = reconcile(s4).find((x) => x.code === "INVOICE_TOTAL_OK");
  assert.ok(okBoth, "should find INVOICE_TOTAL_OK when both freight and insurance are present");

  // 5. Mismatched total: statedTotal differs from components
  const s5 = sample();
  s5.invoice.freight = 3850;
  s5.invoice.insurance = 185;
  s5.invoice.statedTotal = (s5.invoice.statedFobTotal ?? 0) + 3850 + 185 + 99.99;
  const warnMismatch = reconcile(s5).find((x) => x.code === "INVOICE_TOTAL");
  assert.ok(warnMismatch, "should flag INVOICE_TOTAL mismatch when statedTotal differs");
  assert.match(warnMismatch.message, /invoice states grand total/);
});

test("unit compatibility flags incompatible quantity and package units as blocking findings", async () => {
  // UNIT_INCOMPATIBLE test
  const sQty = sample();
  sQty.invoice.lines[0].unit = "DOZ"; // dozen vs pcs on packing list
  const recQty = reconcile(sQty);
  const findUnit = recQty.find((x) => x.code === "UNIT_INCOMPATIBLE");
  assert.ok(findUnit, "should flag UNIT_INCOMPATIBLE when units are incompatible");
  
  // PKG_UNIT_INCOMPATIBLE test
  const sPkg = sample();
  sPkg.bol.packageUnit = "PALLETS"; // pallets vs cartons on packing list
  const recPkg = reconcile(sPkg);
  const findPkg = recPkg.find((x) => x.code === "PKG_UNIT_INCOMPATIBLE");
  assert.ok(findPkg, "should flag PKG_UNIT_INCOMPATIBLE when package units are incompatible");

  // Verify they block readiness
  const rQty = await processShipment(sQty, {}, T);
  assert.equal(rQty.readyToFile, false, "UNIT_INCOMPATIBLE must block readyToFile");
  assert.ok(rQty.findings.some((f) => f.code === "UNIT_INCOMPATIBLE"));
  assert.match(rQty.readinessNote, /blocking document discrepancy/i);

  const rPkg = await processShipment(sPkg, {}, T);
  assert.equal(rPkg.readyToFile, false, "PKG_UNIT_INCOMPATIBLE must block readyToFile");
  assert.ok(rPkg.findings.some((f) => f.code === "PKG_UNIT_INCOMPATIBLE"));
  assert.match(rPkg.readinessNote, /blocking document discrepancy/i);
});

// ---------- 10. fixture vs real PDFs ----------
const uploads = process.env["SEFER_SAMPLE_PDFS"] ?? "";
test("fixture invoice values match the invoice PDF text layer (skipped if PDFs absent)", { skip: !uploads || !existsSync(uploads) || !readdirSync(uploads).some((f: string) => /Commercial_Invoice/.test(f)) }, () => {
  execFileSync("node", [resolve(root, "scripts/trace-source.mjs"), uploads], { stdio: "pipe" });
});
