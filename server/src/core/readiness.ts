import type { Assumption, Finding, MissingItem, ValidationResult, Valuation } from "./types.ts";

/**
 * Named readiness policy. Readiness is decided by NAMED rules, never by a generic severity count, so a
 * finding cannot silently stop being blocking merely because someone changed its severity from "error"
 * to "warn". The policy is fail-safe: a finding code is BLOCKING unless it is explicitly listed here as
 * informational. Adding a new informational finding therefore requires a deliberate edit to this file.
 */
export const INFORMATIONAL_FINDINGS = new Set<string>([
  "INVOICE_TOTAL_OK",       // a positive confirmation, not an open item
  "INVOICE_PRINTED_SUM_OK", // ditto
  "CIF_DEDUCT",             // explanatory
  "FOC",                    // free-of-charge handling note (the customs value is still a source component)
  "ASSIST",                 // surfaced as a pending suggestion, which is counted separately
  "QTY_HYPOTHESIS",         // a hypothesis accompanying a blocking QTY_MISMATCH
  "TOTAL_PCS",              // informational piece-count comparison
  "EXTRACTION_NOTE",        // an extractor note; surfaced, not itself blocking
  "DUPLICATE_STYLE",        // repeated style codes on separate lines can be legitimate; surfaced for review, not blocking
]);

/** Short human reason per blocking code, used in the readiness note. */
export const BLOCKING_FINDING_REASONS: Record<string, string> = {
  LINE_AMOUNT: "a printed line amount disagrees with quantity x unit price",
  INVOICE_PRINTED_SUM: "the invoice's printed line totals do not reconcile",
  INVOICE_TOTAL: "the invoice's printed totals do not reconcile",
  INVOICE_NO_CHARS: "the invoice number was transformed for the schema",
  INVOICE_NO_TRUNCATED: "the invoice number was truncated for the schema",
  QTY_MISMATCH: "a quantity differs between documents",
  DUPLICATE_STYLE: "a style appears on more than one line",
  DUPLICATE_LINE_NO: "a line number is duplicated",
  STYLE_MISSING_PL: "an invoiced style is missing from the packing list",
  PKG_MISMATCH: "package counts differ between documents",
  WEIGHT_MISMATCH: "gross weights differ between documents",
  CONTAINER_CHECK: "a container number fails its ISO 6346 check digit",
  CONTAINER_CORRECTED: "a container number was corrected by hand",
  NO_CONTAINER: "no container number was found on the B/L",
  MIXED_ORIGIN: "several countries of origin appear on one invoice",
  HTS10_MISSING: "a line has no 10-digit HTSUS classification",
  ORIGIN_MISSING: "a line has no country of origin stated on any document",
  NET_GT_GROSS: "net weight exceeds gross weight",
  ETA_BEFORE_ONBOARD: "the B/L ETA precedes the on-board date",
  DUPLICATE_CONTAINER: "a container number is duplicated",
  PACKAGES_ZERO: "the package count is zero",
  GROSS_ZERO: "the gross weight is zero",
  ZERO_QUANTITY: "a line has a non-positive quantity",
  INVOICE_NO_EMPTY: "the invoice number has no usable characters",
  UNIT_INCOMPATIBLE: "invoice and packing list quantities use incompatible units",
  PKG_UNIT_INCOMPATIBLE: "package units between packing list and B/L are incompatible",
};

/** A finding blocks readiness unless it is explicitly informational. */
export const isBlockingFinding = (code: string): boolean => !INFORMATIONAL_FINDINGS.has(code);

export interface Readiness {
  readyToFile: boolean;
  note: string;
  blockingMissing: number;
  unconfirmedAssumptions: number;
  pendingSuggestions: number;
  blockingFindings: number;
}

export function assessReadiness(args: {
  validation: ValidationResult; missing: MissingItem[]; assumptions: Assumption[]; valuation: Valuation; findings: Finding[];
}): Readiness {
  const { validation, missing, assumptions, valuation, findings } = args;
  const blockingMissing = missing.filter((m) => m.blocking);
  const unconfirmed = assumptions.filter((a) => a.status === "assumed" || a.status === "broker_confirm");
  const blockingFindings = findings.filter((f) => isBlockingFinding(f.code));
  const pending = valuation.pending;

  // Independent reconciliation of the entered total against the sum of the line values.
  const sumLines = Math.round(valuation.lines.reduce((n, l) => n + l.value, 0) * 100) / 100;
  const totalMismatch = Math.abs(sumLines - valuation.entered) > 0.005;

  // Readiness requires validation that is BOTH successful AND complete. A pass against a bundled subset (or an
  // unverified schema) is not complete, so it can never imply filing readiness.
  const schemaComplete = validation.valid && validation.complete;
  const ready = schemaComplete && blockingMissing.length === 0 && unconfirmed.length === 0 && blockingFindings.length === 0 && pending === 0 && !totalMismatch;

  const note = ready
    ? "Schema-valid with no open items. A licensed broker must still review before filing."
    : `NOT ready to file: ${!validation.valid ? "the XML did not pass schema validation" : validation.complete ? "the XML is schema-valid, but structure alone proves nothing" : "the XML only passed a PARTIAL (bundled-subset) schema check, which cannot establish full NetCHB compatibility"}. `
      + `${blockingMissing.length} blocking missing input(s), ${unconfirmed.length} assumption(s) needing confirmation, `
      + `${pending} suggested value change(s) not approved, ${blockingFindings.length} blocking document discrepancy(ies)`
      + `${totalMismatch ? `, entered total does not equal the sum of line values` : ""}.`;

  return { readyToFile: ready, note, blockingMissing: blockingMissing.length, unconfirmedAssumptions: unconfirmed.length, pendingSuggestions: pending, blockingFindings: blockingFindings.length };
}
