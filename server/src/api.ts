// Framework-independent request handlers. app.ts adapts them to Express; tests call them directly.
import { checkPdf, DEFAULT_MODEL, extractShipment, MAX_FILES, safeName, UploadError, ExtractionInvalidError, type PdfDoc } from "./core/extract.ts";
import { brokerInputsSchema, formatZodError, regenerateRequestSchema } from "./core/schemas.ts";
import { validatorStatus } from "./core/validate.ts";
import { buildEntryResponse } from "./contract.ts";
import type { BrokerInputs, Shipment } from "./core/types.ts";

export interface ApiDeps {
  apiKey?: string | undefined;
  model?: string | undefined;
  extract?: (docs: PdfDoc[], cfg: { apiKey: string; model?: string }) => Promise<Shipment>;
  today?: () => string;
}
export interface ApiResult { status: number; body: unknown }
const fail = (status: number, code: string, error: string, details?: unknown): ApiResult => ({ status, body: { error, code, ...(details ? { details } : {}) } });

function safeBrokerJson(raw: string | undefined): { broker?: BrokerInputs } | ApiResult {
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return fail(400, "BAD_REQUEST", "The 'broker' field must be valid JSON."); }
  const r = brokerInputsSchema.safeParse(parsed);
  return r.success ? { broker: r.data as BrokerInputs } : fail(400, "BAD_REQUEST", `Invalid broker inputs: ${formatZodError(r.error)}`);
}

function toResult(e: unknown, context: string): ApiResult {
  if (e instanceof UploadError) return fail(e.status, e.status === 413 ? "TOO_LARGE" : e.status === 415 ? "BAD_PDF" : e.status === 502 ? "MODEL_ERROR" : "BAD_REQUEST", e.message);
  if (e instanceof ExtractionInvalidError) return fail(422, "EXTRACTION_INVALID", `${e.message}. No entry was produced; nothing was guessed.`);
  // Unknown errors can contain upstream request metadata or credentials. Log only a stable error class.
  const errorName = e instanceof Error ? e.name : "UnknownError";
  console.error(`[${context}]`, errorName);
  return fail(500, "INTERNAL", "Unexpected server error. Nothing was filed or submitted.");
}

export async function handleEntryUpload(files: { name: string; data: Buffer }[], fields: Record<string, string | undefined>, deps: ApiDeps): Promise<ApiResult> {
  try {
    if (!files.length) return fail(400, "NO_DOCUMENTS", "Upload at least one PDF in the multipart field 'documents'.");
    if (files.length > MAX_FILES) return fail(400, "TOO_MANY_FILES", `At most ${MAX_FILES} documents per shipment.`);
    const docs = files.map((f) => checkPdf(f.name, f.data));
    const b = safeBrokerJson(fields["broker"]);
    if ("status" in b) return b;
    if (!deps.apiKey) return fail(503, "NO_API_KEY", "The extraction model is not configured. Set GEMINI_API_KEY in .env and restart the server.");
    const extract = deps.extract ?? extractShipment;
    const source = await extract(docs, { apiKey: deps.apiKey, ...(deps.model ? { model: deps.model } : {}) });
    const opts = { ...(b.broker ? { broker: b.broker } : {}), ...(deps.today ? { today: deps.today() } : {}) };
    return { status: 200, body: await buildEntryResponse(source, opts) };
  } catch (e) { return toResult(e, "entry"); }
}

export async function handleRegenerate(body: unknown, deps: ApiDeps): Promise<ApiResult> {
  try {
    const r = regenerateRequestSchema.safeParse(body);
    if (!r.success) return fail(400, "BAD_REQUEST", `Invalid request: ${formatZodError(r.error)}`);
    const opts = { edited: r.data.shipment, ...(r.data.broker ? { broker: r.data.broker as BrokerInputs } : {}), ...(deps.today ? { today: deps.today() } : {}) };
    return { status: 200, body: await buildEntryResponse(r.data.source as Shipment, opts) };
  } catch (e) { return toResult(e, "regenerate"); }
}

export async function handleHealth(deps: ApiDeps): Promise<ApiResult> {
  const v = await validatorStatus();
  return { status: 200, body: { ok: true, extraction: { configured: Boolean(deps.apiKey), model: deps.model ?? DEFAULT_MODEL },
    validation: v, netchb: { connected: false, note: "Nothing is ever submitted to NetCHB or CBP." } } };
}
export { safeName };
