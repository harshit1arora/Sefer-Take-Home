import { describe, expect, it, vi, afterEach } from 'vitest';
import { entryResponseSchema, validationLabel } from '@/features/entry/models';
import { isPdf, detectDocumentType } from '@/features/entry/documents';
import { getServiceStatus, processEntry, regenerateEntry } from '@/features/entry/api';
import { backendResponse, clone } from './fixtures/backendResponse';

afterEach(() => vi.restoreAllMocks());
const pdf = () => new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' });
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init });

describe('Backend response contract and source-value integrity', () => {
  const { shipment, findings, valuation } = backendResponse;
  it('preserves identifiers and parties exactly as extracted', () => {
    expect(shipment.invoiceNumber).toBe('HLAS/BP/26-0912'); expect(shipment.billOfLading).toBe('BMLVHCM26090001');
    expect(shipment.buyer).toBe('Bluepeak Outfitters, Inc.'); expect(shipment.consignee).toBe('Summit Fulfillment Partners LLC');
    expect(shipment.isDemo).toBe(false);
  });
  it('preserves CIF, freight, insurance, cartons and the B/L gross weight', () => {
    expect([shipment.invoiceValue, shipment.freight, shipment.insurance, shipment.packages]).toEqual([27270, 3850, 185, 138]);
    expect(shipment.grossWeight).toBe(1930); expect(shipment.netWeight).toBe(1734.5); expect(shipment.volume).toBe(13.58);
  });
  it('keeps the printed amounts, including the T-shirt amount of 6,480, unchanged', () => {
    expect(shipment.lines.map(line => [line.style, line.amount])).toEqual([['BP-T101', 6480], ['BP-H205', 8880], ['BP-C330', 6255], ['W-B220', 1260], ['BP-P118S', 24]]);
    expect(shipment.lines.filter(line => !line.freeOfCharge).reduce((total, line) => total + (line.amount ?? 0), 0)).toBe(22875);
  });
  it('separates commercial goods and free samples by quantity and origin', () => {
    expect(shipment.commercialQuantity).toBe(5100); expect(shipment.lines[4]).toMatchObject({ quantity: 24, origin: 'Bangladesh', freeOfCharge: true });
    expect(shipment.origin).toBe('Vietnam / Bangladesh');
  });
  it('invents no tariff classification: lines carry only the printed 6-digit HS codes', () => {
    expect(shipment.lines.map(line => line.hsCode)).toEqual(['6109.10', '6110.20', '6203.42', '6206.40', '6106.10']);
    expect(shipment.lines.every(line => line.hsCode.replace(/\D/g, '').length < 10)).toBe(true);
  });
  it('raises findings for each source discrepancy and each missing customs input', () => {
    const titles = findings.map(finding => finding.title);
    for (const expected of ['Mixed countries of origin', 'Buyer-supplied fabric may be an assist', 'Free-of-charge samples need valuation review', 'FOB total needs reconciliation',
      'Invoice line amount differs from quantity × unit price', 'Quantity differs between invoice and packing list', 'Container number was corrected by hand on the B/L', 'Tariff classification remains incomplete',
      'Suggested value changes await broker approval', 'Missing before filing: importer-tax-id', 'Missing before filing: processing-port', 'Missing before filing: surety-code / bond']) expect(titles).toContain(expected);
    expect(findings.find(finding => finding.title.startsWith('Invoice line amount'))?.description).toContain('printed amount 6480.00');
  });
  it('keeps the suggested USD 360 correction and the USD 4,180 assist out of the entered value', () => {
    expect(valuation?.entered).toBe(22899); expect(valuation?.enteredIfAllSuggestionsAccepted).toBe(27439); expect(valuation?.pending).toBe(2);
    const tshirt = valuation?.lines.find(line => line.style === 'BP-T101'); const blouse = valuation?.lines.find(line => line.style === 'W-B220');
    expect(tshirt?.components.map(c => [c.id, c.amount, c.provenance, c.included])).toEqual([['invoice-amount', 6480, 'source', true], ['recomputed-delta', 360, 'suggested', false]]);
    expect(blouse?.components.map(c => [c.id, c.amount, c.provenance, c.included])).toEqual([['invoice-amount', 1260, 'source', true], ['assist', 4180, 'suggested', false]]);
  });
  it('is honest about readiness and about the NetCHB check', () => {
    expect(backendResponse.readiness?.readyToFile).toBe(false); expect(backendResponse.readiness?.note).toContain('NOT ready to file');
    expect(backendResponse.validation.netchb).toMatchObject({ status: 'unavailable', confirmedByBackend: false });
  });
  it('still parses a minimal response without the additive fields', () => {
    const { shipment: s, findings: f, xml, validation } = clone(backendResponse);
    expect(entryResponseSchema.safeParse({ shipment: s, findings: f, xml, validation }).success).toBe(true);
  });
  it('rejects responses that break the contract', () => {
    expect(entryResponseSchema.safeParse({ ...clone(backendResponse), xml: 42 }).success).toBe(false);
    expect(entryResponseSchema.safeParse({ ...clone(backendResponse), findings: [{ id: 'x', severity: 'critical', title: 't', description: 'd' }] }).success).toBe(false);
  });
});

describe('Validation labels', () => {
  it('never labels validation successful without backend confirmation', () => { expect(validationLabel({ status: 'passed', confirmedByBackend: false })).toBe('Not verified'); });
  it('labels a complete-schema pass as confirmed and a subset pass as partial', () => {
    expect(validationLabel({ status: 'passed', confirmedByBackend: true })).toBe('Confirmed by backend');
    expect(validationLabel({ status: 'passed', confirmedByBackend: true, complete: true })).toBe('Confirmed by backend');
    expect(validationLabel({ status: 'passed', confirmedByBackend: true, complete: false })).toBe('Passed · partial schema only');
  });
  it('labels failed, unavailable and not-run checks', () => {
    expect(validationLabel({ status: 'failed', confirmedByBackend: true })).toBe('Failed'); expect(validationLabel({ status: 'unavailable', confirmedByBackend: false })).toBe('Unavailable'); expect(validationLabel({ status: 'not_run', confirmedByBackend: false })).toBe('Not checked');
  });
  it('the real response reports the XSD pass as partial when only the bundled subset was used', () => {
    expect(backendResponse.validation.xsd.complete).toBe(false); expect(validationLabel(backendResponse.validation.xsd)).toBe('Passed · partial schema only');
  });
});

describe('Documents', () => {
  it('accepts PDF files only', () => { expect(isPdf({ name: 'invoice.pdf', type: 'application/pdf' })).toBe(true); expect(isPdf({ name: 'invoice.txt', type: 'text/plain' })).toBe(false); });
  it('labels the three shipment documents from their file names', () => {
    expect(detectDocumentType('HLAS-BP-26-0912_Commercial_Invoice.pdf')).toBe('Commercial invoice'); expect(detectDocumentType('EXG-PL-2609-117_Packing_List.pdf')).toBe('Packing list');
    expect(detectDocumentType('BMLVHCM26090001_House_BL.pdf')).toBe('Bill of lading'); expect(detectDocumentType('notes.pdf')).toBe('Unclassified PDF');
  });
});

describe('API client', () => {
  it('sends real files as multipart `documents` and nothing else', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(backendResponse));
    await processEntry([pdf()]);
    expect(fetcher).toHaveBeenCalledWith('/api/entry', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }));
    const body = fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(Array.from(body.keys())).toEqual(['documents']); expect((body.get('documents') as File).name).toBe('invoice.pdf');
  });
  it('adds broker inputs only when provided', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(backendResponse));
    await processEntry([pdf()], undefined, { importerTaxId: '12-3456789' });
    const body = fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(Array.from(body.keys())).toEqual(['documents', 'broker']); expect(JSON.parse(body.get('broker') as string)).toEqual({ importerTaxId: '12-3456789' });
  });
  it('refuses to call the service without PDFs', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(processEntry([])).rejects.toThrow('Add at least one PDF'); await expect(processEntry([new File(['x'], 'a.txt', { type: 'text/plain' })])).rejects.toThrow('Only PDF');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects non-JSON, demo or contract-breaking responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html/>', { headers: { 'content-type': 'text/html' } }));
    await expect(processEntry([pdf()])).rejects.toThrow('supported response');
    const demo = clone(backendResponse); demo.shipment.isDemo = true;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(demo)); vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(processEntry([pdf()])).rejects.toThrow('incomplete or unverified');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ shipment: {} }));
    await expect(processEntry([pdf()])).rejects.toThrow('incomplete or unverified');
  });
  it('keeps uploaded documents retryable when the entry API returns an error without a message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    await expect(processEntry([pdf()])).rejects.toThrow('Processing failed (503). Your documents are still available to retry.');
  });
  it('shows the backend’s own error message (missing key, invalid extraction, bad PDF)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'The extraction model is not configured. Set GEMINI_API_KEY in .env and restart the server.', code: 'NO_API_KEY' }, { status: 503 }));
    await expect(processEntry([pdf()])).rejects.toThrow('GEMINI_API_KEY');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'Extraction invalid: invoice.date: must be an ISO date', code: 'EXTRACTION_INVALID' }, { status: 422 }));
    await expect(processEntry([pdf()])).rejects.toThrow('Extraction invalid');
  });
  it('explains an unreachable service without claiming anything was processed', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(processEntry([pdf()])).rejects.toThrow('could not be reached');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not found', { status: 404 }));
    await expect(processEntry([pdf()])).rejects.toThrow('not reachable');
  });
  it('regenerates from the original extraction plus the edited shipment', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(backendResponse));
    const edited = clone(backendResponse.shipment); edited.lines[0]!.hsCode = '6109100012';
    await regenerateEntry({ source: backendResponse.source!, shipment: edited, broker: { approvals: { acceptAssist: ['W-B220'] } } });
    expect(fetcher).toHaveBeenCalledWith('/api/entry/regenerate', expect.objectContaining({ method: 'POST' }));
    const sent = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string);
    expect(Object.keys(sent).sort()).toEqual(['broker', 'shipment', 'source']); expect(sent.shipment.lines[0].hsCode).toBe('6109100012'); expect(sent.source.invoice.lines[0].statedAmount).toBe(6480);
  });
  it('reads service status and returns null when the service is down or answers unexpectedly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ ok: true, extraction: { configured: true, model: 'm' }, validation: { backend: 'xmllint-wasm', schema: 'official', complete: true } }));
    expect(await getServiceStatus()).toMatchObject({ extraction: { configured: true }, validation: { complete: true } });
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('down')); expect(await getServiceStatus()).toBeNull();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ nope: 1 })); expect(await getServiceStatus()).toBeNull();
  });
});
