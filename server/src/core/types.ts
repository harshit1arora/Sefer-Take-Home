export interface Party {
  name: string; address1?: string; city?: string; state?: string; zip?: string; country?: string;
}
export interface InvoiceLine {
  id?: string;                  // stable internal identity, independent of style/lineNo (assigned once)
  lineNo: number; style: string; description: string;
  hts?: string;                 // as printed (often 6-digit HS)
  quantity: number; unit: string; unitPrice: number;
  statedAmount: number;         // as printed on the invoice
  originCountry?: string;       // ISO-2; UNDEFINED when no document states it (never inferred)
  exportCountry?: string;       // ISO-2; source-stated country of export for this line, never inferred from origin
  isFreeOfCharge: boolean;
  customsValue?: number;        // value stated "for customs purposes only" (FOC lines)
  assistValue?: number;         // buyer-supplied material not on invoice
  manufacturer?: Party;         // overrides shipment-level factory
  manufacturerId?: string;      // identifier printed on a source document; never synthesized as verified
  amountOverride?: number;      // broker-entered amount; the printed statedAmount is never overwritten
  addedByBroker?: boolean;      // line does not exist on the documents
}
export interface Shipment {
  invoice: {
    number: string; date: string; currency: string; incoterm?: string;
    freight?: number; insurance?: number; statedTotal?: number;
    statedFobTotal?: number; statedSubtotalCarriedForward?: number;
    seller: Party; buyer: Party; shipTo?: Party; po?: string;
    portOfLoading?: string; portOfDischarge?: string;
    lines: InvoiceLine[];
  };
  packing: { number?: string; cartons: number; grossKg: number; netKg?: number; cbm?: number;
             lines: { style: string; pcs: number }[] };
  bol: {
    houseBill: string; masterBill?: string; houseScac?: string; masterScac?: string;
    vessel?: string; voyage?: string; portOfLoading?: string; portOfDischarge?: string;
    onBoardDate?: string; etaDate?: string; goodsDescription?: string;
    containers: { number: string; seal?: string; size?: string; printedNumber?: string; correctionNote?: string }[];
    packages: number; packageUnit?: string; grossKg: number;
  };
  factory?: Party;             // actual manufacturer for the main goods
  extractionNotes?: string[];  // uncertainties the extractor reported (handwriting, ambiguous dates, illegible fields)
}
export type Severity = "error" | "warn" | "info";
export interface Finding { severity: Severity; code: string; message: string }
export type AssumptionStatus = "verified" | "derived" | "assumed" | "broker_confirm" | "broker_approved" | "broker_supplied";
export type Provenance = "source" | "derived" | "suggested" | "broker_approved";
export interface Assumption { field: string; value: string; status: AssumptionStatus; basis: string }
export interface MissingItem { field: string; why: string; blocking: boolean }
export interface BrokerInputs {
  filerCode?: string; importerTaxId?: string; processingPort?: string; entryPort?: string;
  entryType?: string; suretyCode?: string; locationOfGoods?: string; ultimateConsigneeTaxId?: string;
  htsByStyle?: Record<string, string>;      // broker-approved 10-digit HTSUS, keyed by the line's STABLE id (name kept for compatibility)
  lineEvidence?: Record<string, BrokerLineEvidence>; // keyed by stable line id; values are never applied without approval
  approvals?: Approvals;                    // explicit broker decisions on suggested value components
}
export interface BrokerLineEvidence {
  manufacturerId?: { value: string; approved: boolean };
  countryOfExport?: { value: string; approved: boolean };
}
/** Explicit broker decisions. Nothing suggested is included in the entered value unless approved here. */
export interface Approvals { acceptRecomputedAmounts?: string[] | "all"; acceptAssist?: string[] | "all" }
export interface ValueComponent {
  id: string; label: string; amount: number; provenance: Provenance; included: boolean; basis: string;
}
export interface LineValuation { id: string; lineNo: number; style: string; components: ValueComponent[]; value: number; valueIfAllSuggestionsAccepted: number }
export interface Valuation {
  lines: LineValuation[];
  entered: number;                       // sum of included components only
  enteredIfAllSuggestionsAccepted: number;
  excluded: { label: string; amount: number; why: string }[];
  pending: number;                       // suggested components not yet approved
  method: string;
}
export interface BuildResult {
  xml: string; assumptions: Assumption[]; missing: MissingItem[];
  totals: { entered: number; byLine: { style: string; value: number }[] };
  valuation: Valuation;
}
export interface ValidationResult {
  valid: boolean;      // syntax ok AND schema validation ran and passed
  schema: "official" | "subset" | "none"; schemaPath: string; errors: string[];
  complete: boolean;   // false = bundled subset or unverified copy: parts of the schema were NOT checked
  note: string;
  backend: "xmllint" | "xmllint-wasm" | "none";
  syntax: { ok: boolean; errors: string[] };
  xsd: { ran: boolean; ok: boolean };
}
