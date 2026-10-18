import { entryResponseSchema, serviceStatusSchema, type EntryResponse, type ServiceStatus } from './models';
import { isPdf } from './documents';

/** Broker-supplied inputs and explicit approvals, as the backend expects them. */
export type BrokerPayload = Record<string, unknown>;

const NOT_JSON = 'The entry service did not return a supported response. No extraction or validation has been confirmed.';
const REJECTED = 'The entry service returned an incomplete or unverified response. No results have been accepted.';

async function failure(response: Response): Promise<Error> {
  // The backend sends { error, code } with messages written to be shown to users.
  try { const body: unknown = await response.clone().json(); if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error) return new Error(body.error); } catch { /* not JSON */ }
  if (response.status === 404 || response.status === 405) return new Error('The entry service is not reachable. Start the backend (npm run dev) and retry. Your documents have not been processed.');
  return new Error(`Processing failed (${response.status}). Your documents are still available to retry.`);
}
async function accept(response: Response): Promise<EntryResponse> {
  if (!response.ok) throw await failure(response);
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(NOT_JSON);
  const result = entryResponseSchema.safeParse(await response.json());
  if (!result.success || result.data.shipment.isDemo) { if (!result.success) console.error('Entry response rejected', result.error.issues); throw new Error(REJECTED); }
  return result.data;
}
async function send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  try { return await fetch(url, { ...init, ...(signal ? { signal } : {}) }); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('The entry service could not be reached. Your documents have not been processed.');
  }
}

/** Uploads the PDFs as multipart field `documents`. Nothing is simulated: the response comes from the backend. */
export async function processEntry(documents: File[], signal?: AbortSignal, broker?: BrokerPayload): Promise<EntryResponse> {
  if (!documents.length) throw new Error('Add at least one PDF before processing.');
  if (documents.some(file => !isPdf(file))) throw new Error('Only PDF documents are supported.');
  const body = new FormData();
  documents.forEach(file => body.append('documents', file, file.name));
  if (broker && Object.keys(broker).length) body.append('broker', JSON.stringify(broker));
  return accept(await send('/api/entry', { method: 'POST', body }, signal));
}

/** Rebuilds the XML from the edited shipment. The backend applies edits to the original extraction and records each one. */
export async function regenerateEntry(args: { source: Record<string, unknown>; sourceProof?: string; shipment: EntryResponse['shipment']; broker?: BrokerPayload }, signal?: AbortSignal): Promise<EntryResponse> {
  const response = await send('/api/entry/regenerate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) }, signal);
  return accept(response);
}

export async function getServiceStatus(signal?: AbortSignal): Promise<ServiceStatus | null> {
  try {
    const response = await fetch('/api/health', signal ? { signal } : {});
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    const parsed = serviceStatusSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
