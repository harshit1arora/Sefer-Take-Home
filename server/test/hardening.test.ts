import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isRealDate, normalizeContainerSize, parseDocDate, sanitizeInvoiceNo, splitBill } from "../src/core/normalize.ts";
import { assertShipment, ExtractionInvalidError } from "../src/core/extract.ts";
import { reconcile } from "../src/core/reconcile.ts";
import { computeValuation } from "../src/core/valuation.ts";
import { ensureLineIds } from "../src/core/lineIds.ts";
import { isBlockingFinding, INFORMATIONAL_FINDINGS } from "../src/core/readiness.ts";
import type { Shipment } from "../src/core/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sample = (): Shipment => JSON.parse(readFileSync(resolve(root, "fixtures/sample-shipment.json"), "utf8"));

// ---- A. container size: strict allowlist ----
test("container size accepts only recognised descriptions and rejects malformed values", () => {
  const ok: [string, string][] = [
    ["20'GP", "20 ft"], ["20GP", "20 ft"], ["20 ft", "20 ft"], ["40HC", "40 ft HC"],
    ["40' High Cube", "40 ft HC"], ["45' High Cube", "45 ft HC"], ["53", "53 ft"], ["20 ft HC", "20 ft HC"], ["40 high", "40 ft HC"],
  ];
  for (const [raw, want] of ok) assert.equal(normalizeContainerSize(raw), want, raw);
  for (const bad of ["40XYZ", "20FOO", "45UNKNOWN", "refrigerated", "20ftGPx", "", undefined, "20HCextra", "40HCX", "20ft45"]) {
    assert.equal(normalizeContainerSize(bad as string | undefined), undefined, `"${bad}" must be rejected`);
  }
});

// ---- B. calendar validity ----
test("isRealDate / parseDocDate reject impossible calendar dates", () => {
  assert.equal(isRealDate("2024-02-29"), true, "2024 is a leap year");
  assert.equal(isRealDate("2025-02-29"), false, "2025 is not");
  assert.equal(isRealDate("2026-02-31"), false);
  assert.equal(isRealDate("2026-13-01"), false);
  assert.equal(isRealDate("2026-04-31"), false);
  assert.equal(isRealDate("2026-1-1"), false);
  assert.throws(() => parseDocDate("2026-02-31"), /Impossible date/);
  assert.throws(() => parseDocDate("31/02/2026"), /Impossible date/);
  assert.throws(() => parseDocDate("2026-00-10"), /Impossible date/);
  assert.deepEqual(parseDocDate("29/02/2024"), { iso: "2024-02-29", ambiguous: false });
});

test("the shipment schema rejects an impossible date extracted from a document", () => {
  const s = sample() as any;
  s.invoice.date = "2026-02-31";
  assert.throws(() => assertShipment(s), /real calendar date/);
  s.invoice.date = "2026-09-12"; // valid again
  assert.doesNotThrow(() => assertShipment(s));
});

// ---- D. bill splitting is conservative ----
test("splitBill splits only on an unambiguous SCAC prefix and preserves the printed value otherwise", () => {
  assert.deepEqual(splitBill("OPLU", "OPLUSGN26090001"), { scac: "OPLU", number: "SGN26090001", split: true });
  // does not start with the SCAC -> preserved verbatim, no split, SCAC not asserted
  assert.deepEqual(splitBill("OPLU", "SGN26090001"), { scac: "OPLU", number: "SGN26090001", split: false });
  // characters are NOT stripped to force a match
  assert.deepEqual(splitBill("OPLU", "OPLU SGN26090001"), { scac: "OPLU", number: "OPLU SGN26090001", split: false });
  assert.deepEqual(splitBill(undefined, "X1"), { number: "X1", split: false });
  assert.deepEqual(splitBill("OPLU", ""), { scac: "OPLU", number: "", split: false });
});

// ---- invoice-number truncation is detected, not silent ----
test("sanitizeInvoiceNo reports truncation instead of silently discarding characters", () => {
  assert.deepEqual(sanitizeInvoiceNo("HLAS/BP/26-0912"), { value: "HLAS-BP-26-0912", changed: true, truncated: false });
  const long = sanitizeInvoiceNo("INV2026000000000000000001");
  assert.equal(long.truncated, true);
  assert.equal(long.value.length, 17);
});

// ---- duplicate identifiers are surfaced ----
test("reconcile flags duplicate styles and line numbers", () => {
  const s = sample();
  s.invoice.lines[1].style = s.invoice.lines[0].style;
  s.invoice.lines[1].lineNo = s.invoice.lines[0].lineNo;
  const codes = reconcile(s).map((f) => f.code);
  assert.ok(codes.includes("DUPLICATE_STYLE"), "duplicate style flagged");
  assert.ok(codes.includes("DUPLICATE_LINE_NO"), "duplicate line number flagged");
});

test("an over-long invoice number is a blocking finding", () => {
  const s = sample();
  s.invoice.number = "INV/2026/0000000000000099";
  const f = reconcile(s).find((x) => x.code === "INVOICE_NO_TRUNCATED");
  assert.ok(f, "truncation finding present");
  assert.equal(isBlockingFinding("INVOICE_NO_TRUNCATED"), true);
});

// ---- C. readiness policy is fail-safe ----
test("readiness policy: unknown codes block; only listed informational codes do not", () => {
  for (const code of INFORMATIONAL_FINDINGS) assert.equal(isBlockingFinding(code), false, code);
  for (const code of ["LINE_AMOUNT", "QTY_MISMATCH", "WEIGHT_MISMATCH", "INVOICE_NO_CHARS", "SOMETHING_NEW", "EXTRACTION_NOTE_UNKNOWN"]) {
    assert.equal(isBlockingFinding(code), true, code);
  }
});

// ---- Section 3: repeated styles are legitimate; only genuine duplicate identifiers block ----
test("a repeated style code on separate lines is informational, not blocking", () => {
  const s = sample();
  s.invoice.lines[1].style = s.invoice.lines[0].style; // same style, still a distinct lineNo
  const findings = reconcile(s);
  const dup = findings.find((f) => f.code === "DUPLICATE_STYLE");
  assert.ok(dup, "repeated style is surfaced");
  assert.equal(dup!.severity, "info", "repeated styles are informational");
  assert.equal(isBlockingFinding("DUPLICATE_STYLE"), false, "repeated styles do not block readiness");
  assert.ok(!findings.some((f) => f.code === "DUPLICATE_LINE_NO"), "no false duplicate-line-number finding");
});

test("a genuinely duplicated line number is blocking", () => {
  const s = sample();
  s.invoice.lines[1].lineNo = s.invoice.lines[0].lineNo;
  const dup = reconcile(s).find((f) => f.code === "DUPLICATE_LINE_NO");
  assert.ok(dup, "duplicate line number is surfaced");
  assert.equal(isBlockingFinding("DUPLICATE_LINE_NO"), true, "duplicate line numbers block readiness");
});

// ---- Section 4: non-positive quantities must not produce Infinity/NaN anywhere ----
test("a zero-quantity line is flagged and never yields Infinity/NaN in findings or valuation", () => {
  const s = sample();
  const line = s.invoice.lines[0];
  line.quantity = 0; // printed amount stays 6480, so the amount finding fires
  const findings = reconcile(s);
  assert.ok(findings.some((f) => f.code === "ZERO_QUANTITY"), "non-positive quantity flagged");
  assert.equal(isBlockingFinding("ZERO_QUANTITY"), true);
  for (const f of findings) assert.doesNotMatch(f.message, /Infinity|NaN/, f.code);
  const v = computeValuation(s);
  for (const lv of v.lines) for (const c of lv.components) assert.doesNotMatch(c.basis, /Infinity|NaN/, c.id);
});

test("a zero-quantity free-of-charge line produces a clean valuation basis", () => {
  const s = sample();
  const foc = s.invoice.lines.find((l) => l.isFreeOfCharge)!;
  foc.quantity = 0;
  const v = computeValuation(s);
  const basis = v.lines[4].components[0].basis;
  assert.doesNotMatch(basis, /Infinity|NaN/);
});

test("an invoice number with no usable characters is a blocking finding", () => {
  const s = sample();
  s.invoice.number = "///";
  const f = reconcile(s).find((x) => x.code === "INVOICE_NO_EMPTY");
  assert.ok(f, "empty invoice number flagged");
  assert.equal(isBlockingFinding("INVOICE_NO_EMPTY"), true);
});

// Regression: production extraction failure where Gemini extracted parenthesized amount as negative statedAmount
test("schema rejects negative statedAmount with clear path identifying line and field", () => {
  const s = sample();
  (s.invoice.lines[4] as any).statedAmount = -24;
  assert.throws(
    () => assertShipment(s),
    (err: unknown) => {
      assert.ok(err instanceof ExtractionInvalidError);
      const e = err as Error;
      assert.match(e.message, /invoice\.lines\.4\.statedAmount/);
      assert.match(e.message, /greater than or equal to 0/i);
      return true;
    }
  );
});

test("schema accepts free-of-charge lines with zero commercial amount and separate customs value", () => {
  const s = sample();
  const foc = s.invoice.lines[4];
  foc.isFreeOfCharge = true;
  foc.statedAmount = 0;
  foc.customsValue = 24;
  const validated = assertShipment(s);
  assert.equal(validated.invoice.lines[4].statedAmount, 0);
  assert.equal(validated.invoice.lines[4].customsValue, 24);
  assert.equal(validated.invoice.lines[4].isFreeOfCharge, true);
});

test("schema accepts free-of-charge lines preserving printed commercial amount and separate customs value", () => {
  const s = sample();
  const foc = s.invoice.lines[4];
  foc.isFreeOfCharge = true;
  foc.statedAmount = 24;
  foc.customsValue = 24;
  const validated = assertShipment(s);
  assert.equal(validated.invoice.lines[4].statedAmount, 24);
  assert.equal(validated.invoice.lines[4].customsValue, 24);
  assert.equal(validated.invoice.lines[4].isFreeOfCharge, true);
});

// ---- Regression tests for verified Sefer XML/value issues ----

test("free-of-charge samples: computes total line value of 24.00 even if customsValue was extracted per-unit", () => {
  const s = sample();
  const foc = s.invoice.lines[4];
  foc.isFreeOfCharge = true;
  foc.quantity = 24;
  foc.unitPrice = 1.0;
  foc.statedAmount = 24;
  foc.customsValue = 1.0; // per-unit customs value extracted
  const v = computeValuation(s);
  assert.equal(v.lines[4].value, 24.0);
  assert.equal(v.entered, 22899.0);
});

test("reconciliation of totals: printed commercial lines 1-4 sum to 22875; FOB total 23235; printed CIF 27270", () => {
  const s = sample();
  const paidLines = s.invoice.lines.filter((l) => !l.isFreeOfCharge);
  const paidCommercialSum = paidLines.reduce((acc, l) => acc + l.statedAmount, 0);
  assert.equal(paidCommercialSum, 22875);
  assert.equal(s.invoice.statedFobTotal, 23235);
  assert.equal(s.invoice.freight, 3850);
  assert.equal(s.invoice.insurance, 185);
  assert.equal(s.invoice.statedTotal, 27270);

  // Line 1 calculation: 2400 x 2.85 = 6840 vs printed 6480 (delta 360)
  const line1Calc = s.invoice.lines[0].quantity * s.invoice.lines[0].unitPrice;
  assert.equal(line1Calc, 6840);
  assert.equal(s.invoice.lines[0].statedAmount, 6480);
  const vDefault = computeValuation(s);
  // Unapproved: printed amount 6480 is preserved; 360 delta is suggested only
  assert.equal(vDefault.lines[0].value, 6480);
  const deltaComp = vDefault.lines[0].components.find((c) => c.id === "recomputed-delta");
  assert.ok(deltaComp && deltaComp.provenance === "suggested" && !deltaComp.included);

  // Approving 360 delta updates entered value cleanly
  const withIds = ensureLineIds(s);
  const line1Id = withIds.invoice.lines[0].id!;
  const vApproved = computeValuation(s, { acceptRecomputedAmounts: [line1Id] });
  assert.equal(vApproved.lines[0].value, 6840);
  assert.equal(vApproved.entered, 23259);

  // Approving assist 4180 updates entered value cleanly
  const line4Id = withIds.invoice.lines[3].id!;
  const vAssist = computeValuation(s, { acceptAssist: [line4Id] });
  assert.equal(vAssist.entered, 27079);
});

test("readiness policy: sentinel port 0000, missing importer tax ID, truncation and missing HTS10 block filing", async () => {
  const { processShipment } = await import("../src/core/pipeline.ts");
  const s = sample();
  const res = await processShipment(s, {}, "2026-10-18");
  assert.equal(res.readyToFile, false, "Must not be ready to file with missing broker inputs and assumptions");
  assert.match(res.readinessNote, /NOT ready to file/);
  assert.ok(res.xml.includes("DRAFT ENTRY SUMMARY ONLY"), "XML must be explicitly labeled as DRAFT");
});


