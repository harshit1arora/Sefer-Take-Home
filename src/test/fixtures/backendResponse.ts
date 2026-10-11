import { entryResponseSchema, type EntryResponse } from '@/features/entry/models';
import raw from './backend-response.json';

/**
 * A genuine response produced by the backend code (scripts/make-frontend-fixture.mjs) for the hand-transcribed sample
 * shipment. It is parsed with the production schema, so the fixture can never drift from the contract unnoticed.
 */
export const backendResponse: EntryResponse = entryResponseSchema.parse(raw);
export const clone = <T,>(value: T): T => structuredClone(value);
