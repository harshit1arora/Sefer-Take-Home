import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Plus, ChevronRight, Info, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Navigation, type WorkspaceView } from '@/components/entry/Navigation';
import { SeferBrand } from '@/components/entry/SeferBrand';
import { PdfUpload } from '@/components/entry/PdfUpload';
import { ShipmentSummary, formatMoney } from '@/components/entry/ShipmentSummary';
import { LineItemTable } from '@/components/entry/LineItemTable';
import { ReconciliationFindings } from '@/components/entry/ReconciliationFindings';
import { ValuationPanel } from '@/components/entry/ValuationPanel';
import { XmlViewer } from '@/components/entry/XmlViewer';
import { detectDocumentType, isPdf } from '@/features/entry/documents';
import { getServiceStatus, processEntry, regenerateEntry, type BrokerPayload } from '@/features/entry/api';
import type { BrokerForm, EntryResponse, Finding, ProcessingStage, ServiceStatus, Shipment, ShipmentLine, WorkspaceDocument } from '@/features/entry/models';

export const Route = createFileRoute('/')({
  head: () => ({ meta: [
    { title: 'Sefer Entry Workspace | Customs Entry Automation' },
    { name: 'description', content: 'Review shipment documents, reconcile customs entry details and prepare an entry XML draft in Sefer’s broker workspace.' },
    { property: 'og:title', content: 'Sefer Entry Workspace | Customs Entry Automation' },
    { property: 'og:description', content: 'From shipment documents to a filing-ready draft. A focused workspace for customs brokers, with honest document and validation status.' },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Index,
});
const summaryFields = [
  ['invoiceNumber', 'Invoice number'], ['billOfLading', 'Bill of lading'], ['buyer', 'Buyer'], ['consignee', 'Consignee'],
  ['origin', 'Country of origin'], ['destination', 'Destination port'], ['invoiceValue', 'Invoice value · CIF (USD)'],
  ['freight', 'Freight (USD)'], ['insurance', 'Insurance (USD)'], ['packages', 'Packages (cartons)'], ['grossWeight', 'Gross weight (kg)'],
] as const;
const emptyBroker: BrokerForm = { importerTaxId: '', processingPort: '', entryPort: '', suretyCode: '', entryType: '', locationOfGoods: '' };

/** Broker inputs plus explicit per-component approvals, in the shape the backend validates. Empty fields are omitted, never defaulted. */
function brokerPayload(form: BrokerForm, approved?: Record<string, boolean>): BrokerPayload {
  const out: Record<string, unknown> = {};
  (Object.keys(form) as (keyof BrokerForm)[]).forEach(key => { const value = form[key].trim(); if (value) out[key] = value; });
  if (approved) {
    const styles = (id: string) => Object.entries(approved).filter(([key, on]) => on && key.endsWith(`:${id}`)).map(([key]) => key.slice(0, key.length - id.length - 1));
    const corrections = styles('recomputed-delta'), assists = styles('assist');
    if (corrections.length || assists.length) out['approvals'] = { ...(corrections.length ? { acceptRecomputedAmounts: corrections } : {}), ...(assists.length ? { acceptAssist: assists } : {}) };
  }
  return out;
}
function describeService(service: ServiceStatus | null | 'checking'): { title: string; text: string } {
  if (service === 'checking') return { title: 'Checking entry service.', text: 'Contacting the backend…' };
  if (service === null) return { title: 'Entry service not reachable.', text: 'Start the backend with npm run dev. No extraction, validation or filing acceptance is confirmed.' };
  if (!service.extraction.configured) return { title: 'Extraction model not configured.', text: 'Set GEMINI_API_KEY in .env and restart the backend before processing documents.' };
  const xsd = service.validation.backend === 'none' ? 'no XML validator available' : `${service.validation.schema} schema${service.validation.complete ? '' : ' (partial: bundled subset only)'}`;
  return { title: 'Live document workspace.', text: `Documents are extracted by the configured model. XSD check: ${xsd}. Broker review is required and nothing is submitted to NetCHB or CBP.` };
}
function Index() {
  const [view, setView] = useState<WorkspaceView>('workspace');
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [entry, setEntry] = useState<EntryResponse | null>(null);
  const [stage, setStage] = useState<ProcessingStage>('idle');
  const [error, setError] = useState('');
  const [editingLines, setEditingLines] = useState(false);
  const [stale, setStale] = useState(false);
  const [dialog, setDialog] = useState<'settings' | 'edit' | 'new' | null>(null);
  const [editDraft, setEditDraft] = useState<Shipment | null>(null);
  const [activity, setActivity] = useState<{ id: string; message: string; time: string }[]>([]);
  const [service, setService] = useState<ServiceStatus | null | 'checking'>('checking');
  const [broker, setBroker] = useState<BrokerForm>(emptyBroker);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const controller = useRef<AbortController | null>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const docsRef = useRef<HTMLDivElement>(null);
  const brokerRef = useRef<HTMLDivElement>(null);
  const busy = ['extracting','reconciling','generating','validating'].includes(stage);
  const addActivity = (message: string) => setActivity(current => [{id:crypto.randomUUID(), message, time:new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})},...current]);
  const refreshService = () => { getServiceStatus().then(setService); };
  useEffect(() => { const abort = new AbortController(); getServiceStatus(abort.signal).then(status => { if (!abort.signal.aborted) setService(status); }); return () => abort.abort(); }, []);
  function cancel() { controller.current?.abort(); controller.current = null; setStage(entry ? 'completed' : 'uploaded'); addActivity('Processing cancelled. No new extraction confirmed.'); }
  function addFiles(files: File[]) {
    const valid = files.filter(isPdf); const invalid = files.length - valid.length;
    setError(invalid ? `${invalid} file${invalid > 1 ? 's' : ''} could not be added. Only PDF documents are supported.` : '');
    if (!valid.length) return;
    setDocuments(current => [...current,...valid.map(file => ({ id:crypto.randomUUID(), name:file.name, type:detectDocumentType(file.name), size:file.size, file }))]);
    setStage('uploaded'); if (entry) setStale(true);
    addActivity(`${valid.length} PDF document${valid.length > 1 ? 's' : ''} uploaded. Extraction has not run.`);
  }
  async function process() {
    setError('');
    const files = documents.map(doc => doc.file);
    if (!files.length) { setError('Add at least one PDF before processing.'); return; }
    const abort = new AbortController(); controller.current = abort; setStage('extracting');
    // No simulated intermediate stages: the UI waits for the real backend response.
    try {
      const result = await processEntry(files, abort.signal, brokerPayload(broker));
      if (abort.signal.aborted) return;
      setShipment(result.shipment); setEntry(result); setApproved({}); setStale(false); setStage('completed');
      addActivity('Entry service returned a shipment draft. Broker review required.');
    } catch (problem) { if (abort.signal.aborted) return; setStage('error'); setError(problem instanceof Error ? problem.message : 'Shipment processing failed. Please retry.'); addActivity('Processing failed. No new extraction or validation confirmed.'); }
    finally { if (controller.current === abort) controller.current = null; }
  }
  async function regenerate() {
    setError('');
    if (!entry?.source || !shipment) { setError('Process the documents first; there is no extraction to regenerate from.'); return; }
    const abort = new AbortController(); controller.current = abort; setStage('generating');
    try {
      const result = await regenerateEntry({ source: entry.source, shipment, broker: brokerPayload(broker, approved) }, abort.signal);
      if (abort.signal.aborted) return;
      setShipment(result.shipment); setEntry(result); setStale(false); setStage('completed');
      addActivity(`XML regenerated. ${result.edits?.length ?? 0} broker edit(s) recorded; extracted source values preserved.`);
    } catch (problem) { if (abort.signal.aborted) return; setStage('error'); setError(problem instanceof Error ? problem.message : 'Regeneration failed. Please retry.'); addActivity('Regeneration failed. The previous XML is out of date.'); }
    finally { if (controller.current === abort) controller.current = null; }
  }
  function editLine(id: string, key: keyof ShipmentLine, value: string | number | null) { setShipment(current => current ? {...current, lines:current.lines.map(line => line.id === id ? {...line,[key]:value} : line)} : null); setStale(true); }
  function newShipment() {
    controller.current?.abort(); controller.current = null; setShipment(null); setEntry(null); setDocuments([]); setStage('idle'); setError(''); setStale(false); setEditingLines(false); setBroker(emptyBroker); setApproved({}); setDialog(null); setView('workspace'); addActivity('New shipment workspace opened.');
  }
  function openEdit() { if (!shipment) return; setEditDraft(structuredClone(shipment)); setDialog('edit'); }
  function openSettings() { refreshService(); setDialog('settings'); }
  function handleFinding(target: Finding['target']) {
    if (target === 'summary') { openEdit(); overviewRef.current?.scrollIntoView({behavior:'smooth',block:'center'}); }
    if (target === 'lines') { setEditingLines(true); linesRef.current?.scrollIntoView({behavior:'smooth',block:'center'}); }
    if (target === 'documents') { docsRef.current?.scrollIntoView({behavior:'smooth',block:'center'}); document.getElementById('document-upload')?.click(); }
    if (target === 'broker') brokerRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  const findings = shipment ? entry?.findings ?? [] : [];
  const banner = describeService(service);
  const settingsService = service === 'checking' ? 'Checking…' : service === null ? 'Not reachable' : service.extraction.configured ? `Connected · ${service.extraction.model}` : 'Connected · model key missing';
  const settingsValidation = service === 'checking' ? 'Checking' : service === null ? 'Not available' : service.validation.backend === 'none' ? 'No validator available' : `${service.validation.backend} · ${service.validation.schema} schema${service.validation.complete ? '' : ' (partial)'}`;
  return <><Navigation view={view} onView={setView} onSettings={openSettings}/><main className="main-content">
    <div className="breadcrumb"><span>Workspace</span><ChevronRight size={11}/><span>{view === 'workspace' ? 'Shipment entry' : view === 'shipments' ? 'Shipments' : 'Activity'}</span></div>
    {view === 'workspace' ? <>
      <div className="page-intro"><div><span className="eyebrow">CUSTOMS ENTRY WORKSPACE</span><h1>From shipment documents<br className="hidden sm:block"/> to a filing-ready draft.</h1><p className="intro-copy">Sefer extracts shipment information, reconciles your documents and prepares<br className="hidden lg:block"/> an entry for broker review. You stay in control of the final filing.</p></div><Button className="new-shipment" onClick={() => setDialog('new')}><Plus size={14}/> New shipment</Button></div>
      <div className="status-banner" role="status"><div className="status-banner-content"><Info size={14}/><span><strong>{banner.title}</strong> {banner.text}</span></div></div>
      <div className="workspace-grid"><div ref={docsRef}><PdfUpload documents={documents} stage={stage} error={error} onFiles={addFiles} onRemove={id => { setDocuments(current => current.filter(doc => doc.id !== id)); if (entry) setStale(true); addActivity('PDF document removed.'); }} onProcess={process} onCancel={cancel}/></div><div className="overview-column"><div ref={overviewRef}><ShipmentSummary shipment={shipment} onEdit={openEdit}/></div>{shipment && <div ref={linesRef}><LineItemTable lines={shipment.lines} editing={editingLines} onEditing={setEditingLines} onChange={editLine} onAdd={() => { setShipment(current => current ? {...current,lines:[...current.lines,{id:crypto.randomUUID(),description:'',hsCode:'',quantity:0,unitPrice:null,amount:null,origin:''}]} : null); setStale(true); }} onRemove={id => { setShipment(current => current ? {...current,lines:current.lines.filter(line => line.id !== id)} : null); setStale(true); }}/></div>}</div></div>
      <ReconciliationFindings findings={findings} onAction={handleFinding}/>
      {entry && <div ref={brokerRef}><ValuationPanel entry={entry} approved={approved} onApprove={(key, value) => { setApproved(current => ({...current,[key]:value})); setStale(true); }} broker={broker} onBroker={(key, value) => { setBroker(current => ({...current,[key]:value})); setStale(true); }} disabled={busy}/></div>}
      <XmlViewer entry={entry} stale={stale} busy={busy} onGenerate={regenerate}/>
    </> : view === 'shipments' ? <section className="list-view"><span className="eyebrow">ENTRY WORKSPACE</span><div className="page-intro"><div><h1>Shipments</h1><p className="list-intro">Current-session shipment drafts.</p></div><Button onClick={() => setDialog('new')}><Plus/> New shipment</Button></div>{shipment ? <div className="shipment-list-item"><div><span className="eyebrow">BROKER REVIEW</span><h3>{shipment.invoiceNumber || 'Untitled shipment'}</h3><p>{shipment.buyer} · {shipment.destination}</p></div><span>{formatMoney(shipment.invoiceValue)}</span><Button variant="outline" size="sm" onClick={() => setView('workspace')}>Open workspace <ArrowRight/></Button></div> : <div className="empty-overview"><h3>No shipment drafts yet.</h3><Button variant="outline" onClick={() => setView('workspace')}>Go to workspace <ArrowRight/></Button></div>}</section> : <section className="list-view"><span className="eyebrow">WORKSPACE HISTORY</span><h1>Activity</h1><p className="list-intro">Actions in this session. No customs filings have been submitted.</p>{activity.length ? <ul className="activity-list">{activity.map(item => <li key={item.id}><span className="activity-dot"/><p>{item.message}</p><time>{item.time}</time></li>)}</ul> : <div className="empty-overview"><h3>No activity yet.</h3><p>Shipment actions will appear here during this session.</p></div>}</section>}
    <footer className="app-footer"><div><span className="footer-brand"><SeferBrand/></span><span>Customs, without the complexity.</span></div><span>Broker review required. No entry has been filed.</span></footer>
  </main>
  <Dialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent className="edit-dialog"><DialogHeader><DialogTitle>{dialog === 'edit' ? 'Edit shipment details' : dialog === 'new' ? 'Start a new shipment?' : 'Workspace settings'}</DialogTitle><DialogDescription>{dialog === 'edit' ? 'Confirm details against source documents. Edits are recorded and need a regenerated XML draft.' : dialog === 'new' ? 'This clears the current draft and uploaded documents. Download your XML first if you need to keep it.' : 'Sefer Entry Workspace · Current session'}</DialogDescription></DialogHeader>
    {dialog === 'settings' && <><dl className="settings-info"><div><dt>Workspace</dt><dd>Broker workspace</dd></div><div><dt>Entry service</dt><dd>{settingsService}</dd></div><div><dt>XML validation</dt><dd>{settingsValidation}</dd></div><div><dt>NetCHB</dt><dd>Not connected · nothing is submitted</dd></div><div><dt>Data storage</dt><dd>Current session only · uploads are not stored</dd></div></dl><div className="dialog-actions"><Button onClick={() => setDialog(null)}>Done</Button></div></>}
    {dialog === 'new' && <div className="dialog-actions"><Button variant="outline" onClick={() => setDialog(null)}>Keep current shipment</Button><Button onClick={newShipment}><Plus/> New shipment</Button></div>}
    {dialog === 'edit' && editDraft && <form onSubmit={event => { event.preventDefault(); setShipment(editDraft); setStale(true); setDialog(null); addActivity('Shipment details edited. XML draft needs regeneration.'); }}><div className="form-grid">{summaryFields.map(([key,label]) => <label className="form-field" key={key}>{label}<input value={editDraft[key]} type={typeof editDraft[key] === 'number' ? 'number' : 'text'} min={0} step={key === 'packages' ? '1' : '0.01'} onChange={event => setEditDraft(current => current ? {...current,[key]: typeof current[key] === 'number' ? Math.max(0, Number(event.target.value)) : event.target.value} : null)}/></label>)}</div><div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit">Save changes</Button></div></form>}
  </DialogContent></Dialog></>;
}
