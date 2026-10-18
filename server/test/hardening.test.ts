import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isRealDate, normalizeContainerSize, parseDocDate, sanitizeInvoiceNo, splitBill } from "../src/core/normalize.ts";
import { assertShipment } from "../src/core/extract.ts";
import { reconcile } from "../src/core/reconcile.ts";
import { computeValuation } from "../src/core/valuation.ts";
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
