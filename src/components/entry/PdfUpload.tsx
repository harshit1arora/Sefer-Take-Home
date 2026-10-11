import { useRef, useState } from 'react';
import { Upload, Plus, FileText, X, ArrowRight, Loader2, Check, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProcessingStage, WorkspaceDocument } from '@/features/entry/models';
const steps = ['Uploaded', 'Extracting', 'Reconciling', 'Generating XML', 'Validating'];
export function PdfUpload({ documents, stage, error, onFiles, onRemove, onProcess, onCancel }: { documents: WorkspaceDocument[]; stage: ProcessingStage; error: string; onFiles: (files: File[]) => void; onRemove: (id: string) => void; onProcess: () => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = ['extracting', 'reconciling', 'generating', 'validating'].includes(stage);
  const realCount = documents.length;
  return <section className="documents-section" aria-labelledby="documents-heading">
    <div className="section-heading"><h2 id="documents-heading">Documents <span className="count">{documents.length.toString().padStart(2, '0')}</span></h2><span className="eyebrow">SOURCE FILES</span></div>
    <input ref={input} id="document-upload" type="file" accept="application/pdf,.pdf" multiple className="sr-only" aria-label="Upload PDF documents" disabled={busy} onChange={event => { onFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }}/>
    <div className={`upload-area ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) onFiles(Array.from(event.dataTransfer.files)); }}>
      <span className="upload-icon"><Upload size={23} strokeWidth={1.5}/></span><p>Drop shipment documents here</p><span className="muted small">Commercial invoice, packing list or bill of lading</span><Button variant="outline" size="sm" className="mt-5" onClick={() => input.current?.click()} disabled={busy}><Plus/> Add documents</Button><span className="upload-footnote">PDF files only</span>
    </div>
    <div className="document-list">{documents.length ? documents.map(doc => <div className="document-row" key={doc.id}><span className="pdf-icon"><FileText size={20} strokeWidth={1.4}/><span>PDF</span></span><div className="document-details"><p title={doc.name}>{doc.name}</p><span>{doc.type} · {doc.size < 1024 * 1024 ? `${Math.max(1, Math.round(doc.size / 1024))} KB` : `${(doc.size / (1024 * 1024)).toFixed(1)} MB`}</span><span className="document-state">{busy ? 'Awaiting service response' : 'Uploaded'}</span></div><Button variant="ghost" size="icon" onClick={() => onRemove(doc.id)} disabled={busy} aria-label={`Remove ${doc.name}`} title="Remove document"><X size={14}/></Button></div>) : <p className="empty-documents">No documents added yet.</p>}</div>
    <div className="process-area"><Button className="process-button" onClick={onProcess} disabled={busy || !realCount}>{busy ? <Loader2 className="animate-spin"/> : null}{busy ? 'Waiting for entry service…' : 'Process shipment'}{!busy && <ArrowRight/>}</Button>{busy && <Button variant="ghost" size="sm" onClick={onCancel}>Cancel processing</Button>}<p>PDFs are sent to the entry service for extraction. Nothing is filed.</p></div>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="processing-status"><h3 className="eyebrow">PROCESSING STATUS</h3><ol>{steps.map((step, index) => <li key={step}><span className={index === 0 && realCount ? 'step-icon uploaded' : 'step-icon'}>{index === 0 && realCount ? <Check size={12}/> : <Circle size={10}/>}</span><span>{step}</span><span className="step-state">{index === 0 ? realCount ? `${realCount} PDF${realCount > 1 ? 's' : ''}` : 'No PDFs' : busy ? 'Awaiting confirmation' : 'Not run'}</span></li>)}</ol>{stage === 'completed' && <p className="small muted">Service response received. See findings and validation details below.</p>}</div>
    <div className="document-note"><span className="eyebrow">A SINGLE SOURCE OF TRUTH</span><p>Every document. Every detail.<br/>One entry, ready for your review.</p></div>
  </section>;
}
