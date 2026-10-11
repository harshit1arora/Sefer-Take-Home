import type { Assumption, BrokerInputs, Finding, MissingItem, Shipment, ValidationResult, Valuation } from "./core/types.ts";
import { processShipment } from "./core/pipeline.ts";
import { applyEdits, type EditRecord, type EditResult } from "./edits.ts";
import { toFrontendShipment, type FrontendShipment } from "./frontendShape.ts";

/** Matches `findingSchema` in src/features/entry/models.ts. */
export interface FrontendFinding {
  id: string; severity: "attention" | "review" | "missing"; title: string; description: string; action?: string; target?: "summary" | "lines" | "documents" | "broker";
}
export interface FrontendCheck { status: "not_run" | "passed" | "failed" | "unavailable"; confirmedByBackend: boolean; message?: string; schema?: "official" | "subset" | "none"; complete?: boolean }
export interface EntryResponseBody {
  shipment: FrontendShipment;
  findings: FrontendFinding[];
  xml: string;
  validation: { syntax: FrontendCheck; xsd: FrontendCheck; netchb: FrontendCheck };
  // additive fields (optional in the frontend schema)
  source: Shipment;
  valuation: Valuation;
  assumptions: Assumption[];
  missing: MissingItem[];
  edits: EditRecord[];
  readiness: { readyToFile: boolean; note: string; blockingMissing: number; unconfirmedAssumptions: number; pendingSuggestions: number; documentErrors: number };
}

type Spec = { severity: FrontendFinding["severity"]; title: string; target?: FrontendFinding["target"]; action?: string };
const LINES = { target: "lines", action: "Review lines" } as const;
const SPECS: Record<string, Spec | null> = {
  LINE_AMOUNT: { severity: "attention", title: "Invoice line amount differs from quantity × unit price", ...LINES },
  INVOICE_PRINTED_SUM: { severity: "review", title: "FOB total needs reconciliation", ...LINES },
  INVOICE_TOTAL: { severity: "review", title: "Invoice totals do not add up", ...LINES },
  QTY_MISMATCH: { severity: "attention", title: "Quantity differs between invoice and packing list", ...LINES },
  QTY_HYPOTHESIS: { severity: "review", title: "Possible explanation for the quantity difference", ...LINES },
  STYLE_MISSING_PL: { severity: "review", title: "Style missing from the packing list", ...LINES },
  PKG_MISMATCH: { severity: "attention", title: "Package count differs between packing list and B/L", target: "summary", action: "Edit details" },
  WEIGHT_MISMATCH: { severity: "review", title: "Gross weight differs between documents", target: "summary", action: "Edit details" },
  CONTAINER_CHECK: { severity: "attention", title: "Container number fails its check digit" },
  CONTAINER_CORRECTED: { severity: "attention", title: "Container number was corrected by hand on the B/L" },
  NO_CONTAINER: { severity: "review", title: "No container number found" },
  MIXED_ORIGIN: { severity: "attention", title: "Mixed countries of origin", ...LINES },
  FOC: { severity: "review", title: "Free-of-charge samples need valuation review", ...LINES },
  ASSIST: { severity: "review", title: "Buyer-supplied fabric may be an assist", target: "broker", action: "Review valuation" },
  INVOICE_NO_CHARS: { severity: "review", title: "Invoice number changed for NetCHB", target: "summary", action: "Edit details" },
  EXTRACTION_NOTE: { severity: "review", title: "Extraction note" },
  TOTAL_PCS: { severity: "review", title: "Total pieces differ between documents", ...LINES },
  // purely informational confirmations: shown in the valuation panel, not as open items
  INVOICE_TOTAL_OK: null, INVOICE_PRINTED_SUM_OK: null, CIF_DEDUCT: null, HTS10_MISSING: null,
};

export function mapFindings(findings: Finding[], missing: MissingItem[], valuation: Valuation, edits: EditResult | undefined): FrontendFinding[] {
  const out: FrontendFinding[] = [];
  const push = (f: Omit<FrontendFinding, "id">) => out.push({ id: `f${out.length + 1}`, ...f });
  for (const f of findings) {
    if (f.code === "HTS10_MISSING") continue; // aggregated below
    const spec = SPECS[f.code];
    if (spec === null) continue;
    const s = spec ?? { severity: f.severity === "error" ? "attention" : "review", title: f.code } as Spec;
    push({ severity: s.severity, title: s.title, description: f.message, ...(s.action ? { action: s.action } : {}), ...(s.target ? { target: s.target } : {}) });
  }
  const noHts = findings.filter((f) => f.code === "HTS10_MISSING");
  if (noHts.length) push({ severity: "missing", title: "Tariff classification remains incomplete",
    description: `${noHts.length} line${noHts.length > 1 ? "s have" : " has"} no approved 10-digit HTSUS number: ${noHts.map((f) => /\((.+?)\)/.exec(f.message)?.[1] ?? "?").join(", ")}. The documents carry only 6-digit HS codes; nothing is inferred. A broker must supply the classifications.`,
    action: "Edit line items", target: "lines" });
  if (valuation.pending) push({ severity: "review", title: "Suggested value changes await broker approval",
    description: `${valuation.pending} suggested component${valuation.pending > 1 ? "s are" : " is"} excluded from the entered value (${valuation.entered.toFixed(2)} USD). Approving all would make it ${valuation.enteredIfAllSuggestionsAccepted.toFixed(2)} USD.`,
    action: "Review valuation", target: "broker" });
  for (const m of missing) {
    if (m.field.startsWith("HTSUS 10-digit")) continue; // aggregated above
    push({ severity: "missing", title: m.blocking ? `Missing before filing: ${m.field}` : `Not on the documents: ${m.field}`, description: m.why, action: "Add broker details", target: "broker" });
  }
  for (const e of edits?.edits ?? []) push({ severity: "review", title: "Broker edit applied", description: `${e.target} · ${e.field}: ${e.original} → ${e.edited}. The extracted source value is preserved and the edit is recorded.` });
  for (const i of edits?.ignored ?? []) push({ severity: "review", title: "Edit not applied", description: i });
  return out;
}

export function mapValidation(v: ValidationResult): EntryResponseBody["validation"] {
  const unavailable = v.backend === "none";
  const syntax: FrontendCheck = unavailable
    ? { status: "unavailable", confirmedByBackend: false, message: v.errors.join(" ") }
    : { status: v.syntax.ok ? "passed" : "failed", confirmedByBackend: true, ...(v.syntax.ok ? {} : { message: v.syntax.errors.join("\n") }) };
  const xsd: FrontendCheck = unavailable
    ? { status: "unavailable", confirmedByBackend: false, message: v.note }
    : !v.xsd.ran
      ? { status: "not_run", confirmedByBackend: true, message: "XML is not well-formed, so the schema check was not run." }
      : { status: v.xsd.ok ? "passed" : "failed", confirmedByBackend: true, schema: v.schema, complete: v.complete,
          message: `${v.note}${v.xsd.ok ? "" : "\n" + v.errors.join("\n")}` };
  return {
    syntax, xsd,
    netchb: { status: "unavailable", confirmedByBackend: false, message: "This application never submits to NetCHB or CBP. Acceptance is not checked and is not implied." },
  };
}

export async function buildEntryResponse(
  source: Shipment,
  opts: { edited?: FrontendShipment; broker?: BrokerInputs; today?: string } = {},
): Promise<EntryResponseBody> {
  const edit = opts.edited ? applyEdits(source, opts.edited) : undefined;
  const working = edit?.working ?? source;
  const broker: BrokerInputs = { ...opts.broker, htsByStyle: { ...opts.broker?.htsByStyle, ...edit?.htsByStyle } };
  const r = await processShipment(working, broker, opts.today);
  const blockingMissing = r.missing.filter((m) => m.blocking).length;
  const unconfirmed = r.assumptions.filter((a) => a.status === "broker_confirm" || a.status === "assumed").length;
  const errors = r.findings.filter((f) => f.severity === "error" && f.code !== "HTS10_MISSING").length;
  return {
    shipment: toFrontendShipment(working, broker.htsByStyle),
    findings: mapFindings(r.findings, r.missing, r.valuation, edit),
    xml: r.xml,
    validation: mapValidation(r.validation),
    source,
    valuation: r.valuation,
    assumptions: r.assumptions,
    missing: r.missing,
    edits: edit?.edits ?? [],
    readiness: { readyToFile: r.readyToFile, note: r.readinessNote, blockingMissing, unconfirmedAssumptions: unconfirmed, pendingSuggestions: r.valuation.pending, documentErrors: errors },
  };
}
