import type { Assumption, BrokerInputs, Finding, MissingItem, Shipment, ValidationResult, Valuation } from "./types.ts";
import { reconcile } from "./reconcile.ts";
import { buildEntry } from "./entryXml.ts";
import { validateXml } from "./validate.ts";

export interface EntryResult {
  shipment: Shipment; findings: Finding[]; assumptions: Assumption[]; missing: MissingItem[];
  xml: string; validation: ValidationResult;
  totals: { entered: number; byLine: { style: string; value: number }[] }; valuation: Valuation;
  readyToFile: false | boolean; readinessNote: string;
}

export async function processShipment(s: Shipment, broker: BrokerInputs = {}, today = new Date().toISOString().slice(0, 10)): Promise<EntryResult> {
  const findings = reconcile(s);
  const built = buildEntry(s, broker, { today });
  const validation = await validateXml(built.xml);
  const blocking = built.missing.filter((m) => m.blocking).length;
  const confirm = built.assumptions.filter((a) => a.status === "broker_confirm" || a.status === "assumed").length;
  const errors = findings.filter((f) => f.severity === "error" && f.code !== "HTS10_MISSING").length; // missing HTS is already counted as blocking missing input
  const ready = validation.valid && blocking === 0 && confirm === 0 && errors === 0;
  return {
    shipment: s, findings, assumptions: built.assumptions, missing: built.missing, xml: built.xml,
    validation, totals: built.totals, valuation: built.valuation, readyToFile: ready,
    readinessNote: ready ? "Schema-valid with no open items. A licensed broker must still review before filing."
      : `NOT ready to file: schema validation (${validation.valid ? "passed" : "failed"}) only proves structure. ${blocking} blocking missing input(s), ${confirm} assumption(s) needing confirmation, ${built.valuation.pending} suggested value change(s) not yet approved, ${errors} document discrepancy error(s).`,
  };
}
