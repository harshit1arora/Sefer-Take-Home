import type { Assumption, BrokerInputs, Finding, MissingItem, Shipment, ValidationResult, Valuation } from "./types.ts";
import { reconcile } from "./reconcile.ts";
import { buildEntry } from "./entryXml.ts";
import { validateXml } from "./validate.ts";
import { assessReadiness } from "./readiness.ts";
import { ensureLineIds } from "./lineIds.ts";

export interface EntryResult {
  shipment: Shipment; findings: Finding[]; assumptions: Assumption[]; missing: MissingItem[];
  xml: string; validation: ValidationResult;
  totals: { entered: number; byLine: { style: string; value: number }[] }; valuation: Valuation;
  readyToFile: false | boolean; readinessNote: string;
}

export async function processShipment(s: Shipment, broker: BrokerInputs = {}, today = new Date().toISOString().slice(0, 10)): Promise<EntryResult> {
  const ship = ensureLineIds(s); // stable line ids for valuation approval matching and HTS mapping
  const findings = reconcile(ship);
  const built = buildEntry(ship, broker, { today });
  const validation = await validateXml(built.xml);
  // Readiness comes from a NAMED policy (core/readiness.ts), not a generic severity count.
  const readiness = assessReadiness({ validation, missing: built.missing, assumptions: built.assumptions, valuation: built.valuation, findings });
  return {
    shipment: ship, findings, assumptions: built.assumptions, missing: built.missing, xml: built.xml,
    validation, totals: built.totals, valuation: built.valuation, readyToFile: readiness.readyToFile,
    readinessNote: readiness.note,
  };
}
