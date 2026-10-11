import { z } from 'zod';

export const shipmentLineSchema = z.object({
  id: z.string(), style: z.string().optional(), description: z.string(), hsCode: z.string(), quantity: z.number().nonnegative(), unit: z.string().optional(),
  unitPrice: z.number().nonnegative().nullable(), amount: z.number().nonnegative().nullable(), origin: z.string(), freeOfCharge: z.boolean().optional(),
});
export const shipmentSchema = z.object({
  id: z.string(), invoiceNumber: z.string(), buyer: z.string(), consignee: z.string(), origin: z.string(),
  destination: z.string(), billOfLading: z.string(), invoiceValue: z.number().nonnegative(), freight: z.number().nonnegative(),
  insurance: z.number().nonnegative(), packages: z.number().nonnegative(), grossWeight: z.number().nonnegative(), netWeight: z.number().nonnegative().optional(), volume: z.number().nonnegative().optional(), commercialQuantity: z.number().nonnegative().optional(),
  lines: z.array(shipmentLineSchema), isDemo: z.boolean(),
});
export const findingSchema = z.object({
  id: z.string(), severity: z.enum(['attention', 'review', 'missing']), title: z.string(), description: z.string(),
  action: z.string().optional(), target: z.enum(['summary', 'lines', 'documents', 'broker']).optional(),
});
export const validationCheckSchema = z.object({
  status: z.enum(['not_run', 'passed', 'failed', 'unavailable']), confirmedByBackend: z.boolean(), message: z.string().optional(),
  // XSD check only: which schema was used and whether it is the complete one
  schema: z.enum(['official', 'subset', 'none']).optional(), complete: z.boolean().optional(),
});

// ---- additive fields returned by the backend (all optional so older responses still parse)
export const valueComponentSchema = z.object({
  id: z.string(), label: z.string(), amount: z.number(), provenance: z.enum(['source', 'derived', 'suggested', 'broker_approved']), included: z.boolean(), basis: z.string(),
});
export const valuationSchema = z.object({
  lines: z.array(z.object({ lineNo: z.number(), style: z.string(), value: z.number(), valueIfAllSuggestionsAccepted: z.number(), components: z.array(valueComponentSchema) })),
  entered: z.number(), enteredIfAllSuggestionsAccepted: z.number(), pending: z.number(), method: z.string(),
  excluded: z.array(z.object({ label: z.string(), amount: z.number(), why: z.string() })),
});
export const assumptionSchema = z.object({ field: z.string(), value: z.string(), status: z.enum(['verified', 'derived', 'assumed', 'broker_confirm', 'broker_approved']), basis: z.string() });
export const missingItemSchema = z.object({ field: z.string(), why: z.string(), blocking: z.boolean() });
export const editRecordSchema = z.object({ scope: z.enum(['summary', 'line']), target: z.string(), field: z.string(), original: z.string(), edited: z.string() });
export const readinessSchema = z.object({
  readyToFile: z.boolean(), note: z.string(), blockingMissing: z.number(), unconfirmedAssumptions: z.number(), pendingSuggestions: z.number(), documentErrors: z.number(),
});

export const entryResponseSchema = z.object({
  shipment: shipmentSchema, findings: z.array(findingSchema), xml: z.string(),
  validation: z.object({ syntax: validationCheckSchema, xsd: validationCheckSchema, netchb: validationCheckSchema }),
  source: z.record(z.unknown()).optional(), valuation: valuationSchema.optional(), assumptions: z.array(assumptionSchema).optional(),
  missing: z.array(missingItemSchema).optional(), edits: z.array(editRecordSchema).optional(), readiness: readinessSchema.optional(),
});
export const serviceStatusSchema = z.object({
  ok: z.boolean(),
  extraction: z.object({ configured: z.boolean(), model: z.string() }),
  validation: z.object({ backend: z.enum(['xmllint', 'xmllint-wasm', 'none']), schema: z.enum(['official', 'subset']), complete: z.boolean() }),
});

export type Shipment = z.infer<typeof shipmentSchema>;
export type ShipmentLine = z.infer<typeof shipmentLineSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type EntryResponse = z.infer<typeof entryResponseSchema>;
export type ValidationCheck = z.infer<typeof validationCheckSchema>;
export type Valuation = z.infer<typeof valuationSchema>;
export type ValueComponent = z.infer<typeof valueComponentSchema>;
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export type BrokerForm = { importerTaxId: string; processingPort: string; entryPort: string; suretyCode: string; entryType: string; locationOfGoods: string };
export type WorkspaceDocument = { id: string; name: string; type: string; size: number; file: File };
export type ProcessingStage = 'idle' | 'uploaded' | 'extracting' | 'reconciling' | 'generating' | 'validating' | 'completed' | 'error';

export function validationLabel(check: ValidationCheck): string {
  if (check.status === 'passed') {
    if (!check.confirmedByBackend) return 'Not verified';
    return check.complete === false ? 'Passed · partial schema only' : 'Confirmed by backend';
  }
  if (check.status === 'failed') return 'Failed';
  return check.status === 'unavailable' ? 'Unavailable' : 'Not checked';
}
