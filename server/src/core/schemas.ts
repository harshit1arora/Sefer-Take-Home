import { z } from "zod";
import { isIsoCountry, isRealDate, toIso2 } from "./normalize.ts";
import type { Shipment } from "./types.ts";

const nonNeg = z.number().finite().nonnegative();
const isoDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)")
  .refine(isRealDate, "must be a real calendar date (e.g. 2026-02-31 is not valid)");
// Models sometimes answer "Vietnam" instead of "VN"; map known names, then require two letters.
const iso2 = z.preprocess(
  (v) => (typeof v === "string" ? (toIso2(v) ?? (v.trim() || undefined)) : v),
  z.string().regex(/^[A-Za-z]{2}$/, "must be a two-letter ISO country code").refine(isIsoCountry, "is not an assigned ISO 3166-1 country code").transform((s) => s.toUpperCase()).optional(),
);

export const partySchema = z.object({
  name: z.string().min(1),
  address1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
});

export const invoiceLineSchema = z.object({
  id: z.string().min(1).optional(),
  lineNo: z.number().int().positive(),
  style: z.string().min(1),
  description: z.string(),
  hts: z.string().optional(),
  quantity: nonNeg,
  unit: z.string().default("PCS"),
  unitPrice: nonNeg,
  statedAmount: nonNeg,
  originCountry: iso2, // optional: an unstated origin stays UNKNOWN rather than being inferred
  isFreeOfCharge: z.boolean().default(false),
  customsValue: nonNeg.optional(),
  assistValue: nonNeg.optional(),
  manufacturer: partySchema.optional(),
  amountOverride: nonNeg.optional(),
  addedByBroker: z.boolean().optional(),
});

export const shipmentSchema = z.object({
  invoice: z.object({
    number: z.string().min(1),
    date: isoDate,
    currency: z.string().regex(/^[A-Za-z]{3}$/).transform((s) => s.toUpperCase()),
    incoterm: z.string().optional(),
    freight: nonNeg.optional(),
    insurance: nonNeg.optional(),
    statedTotal: nonNeg.optional(),
    statedFobTotal: nonNeg.optional(),
    statedSubtotalCarriedForward: nonNeg.optional(),
    seller: partySchema,
    buyer: partySchema,
    shipTo: partySchema.optional(),
    po: z.string().optional(),
    portOfLoading: z.string().optional(),
    portOfDischarge: z.string().optional(),
    lines: z.array(invoiceLineSchema).min(1, "at least one invoice line is required"),
  }),
  packing: z.object({
    number: z.string().optional(),
    cartons: z.number().int().nonnegative(),
    grossKg: nonNeg,
    netKg: nonNeg.optional(),
    cbm: nonNeg.optional(),
    lines: z.array(z.object({ style: z.string().min(1), pcs: z.number().int().nonnegative() })),
  }),
  bol: z.object({
    houseBill: z.string().min(1),
    masterBill: z.string().optional(),
    houseScac: z.string().optional(),
    masterScac: z.string().optional(),
    vessel: z.string().optional(),
    voyage: z.string().optional(),
    portOfLoading: z.string().optional(),
    portOfDischarge: z.string().optional(),
    onBoardDate: isoDate.optional(),
    etaDate: isoDate.optional(),
    goodsDescription: z.string().optional(),
    containers: z.array(
      z.object({
        number: z.string().min(1),
        seal: z.string().optional(),
        size: z.string().optional(),
        printedNumber: z.string().optional(),
        correctionNote: z.string().optional(),
      }),
    ),
    packages: z.number().int().nonnegative(),
    packageUnit: z.string().optional(),
    grossKg: nonNeg,
  }),
  factory: partySchema.optional(),
  extractionNotes: z.array(z.string()).optional(),
});

const styleList = z.union([z.literal("all"), z.array(z.string().max(60)).max(200)]);
export const approvalsSchema = z.object({
  acceptRecomputedAmounts: styleList.optional(),
  acceptAssist: styleList.optional(),
});
const short = z.string().trim().max(60);
export const brokerInputsSchema = z.object({
  filerCode: short.optional(),
  importerTaxId: short.optional(),
  processingPort: short.optional(),
  entryPort: short.optional(),
  entryType: short.optional(),
  suretyCode: short.optional(),
  locationOfGoods: short.optional(),
  ultimateConsigneeTaxId: short.optional(),
  htsByStyle: z.record(z.string().max(60), z.string().max(20)).optional(), // keyed by the line's stable id
  approvals: approvalsSchema.optional(),
});

/** The edited shipment as the workspace UI holds it. Mirrors src/features/entry/models.ts. */
export const frontendShipmentSchema = z.object({
  id: z.string(),
  invoiceNumber: z.string(),
  buyer: z.string(),
  consignee: z.string(),
  origin: z.string(),
  destination: z.string(),
  billOfLading: z.string(),
  invoiceValue: nonNeg,
  freight: nonNeg,
  insurance: nonNeg,
  packages: nonNeg,
  grossWeight: nonNeg,
  netWeight: nonNeg.optional(),
  volume: nonNeg.optional(),
  commercialQuantity: nonNeg.optional(),
  lines: z.array(
    z.object({
      id: z.string(),
      style: z.string().optional(),
      description: z.string(),
      hsCode: z.string(),
      quantity: nonNeg,
      unit: z.string().optional(),
      unitPrice: nonNeg.nullable(),
      amount: nonNeg.nullable(),
      origin: z.string(),
      freeOfCharge: z.boolean().optional(),
    }),
  ),
  isDemo: z.boolean(),
});

export const regenerateRequestSchema = z.object({
  source: shipmentSchema,
  sourceProof: z.string().max(200).optional(), // checked against the RAW source in handleRegenerate (api.ts)
  shipment: frontendShipmentSchema,
  broker: brokerInputsSchema.optional(),
});

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

export class ExtractionInvalidError extends Error {
  constructor(message: string) {
    super(`Extraction invalid: ${message}`);
    this.name = "ExtractionInvalidError";
  }
}

/** Runtime validation so malformed model output fails loudly instead of producing a wrong entry. */
export function assertShipment(x: unknown): Shipment {
  const r = shipmentSchema.safeParse(x);
  if (!r.success) throw new ExtractionInvalidError(formatZodError(r.error));
  return r.data as Shipment;
}
