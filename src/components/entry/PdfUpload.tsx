import { useRef, useState } from 'react';
import { Upload, Plus, FileText, X, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProcessingStage, WorkspaceDocument } from '@/features/entry/models';
export function PdfUpload({ documents, stage, error, onFiles, onRemove, onProcess, onCancel }: { documents: WorkspaceDocument[]; stage: ProcessingStage; error: string; onFiles: (files: File[]) => void; onRemove: (id: string) => void; onProcess: () => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = ['extracting', 'reconciling', 'generating', 'validating'].includes(stage);
  const realCount = documents.length;
  return <section className="documents-section" aria-labelledby="documents-heading">
    <div className="section-heading"><h2 id="documents-heading">Upload documents</h2>{documents.length > 0 && <span className="section-meta">{documents.length} PDF{documents.length === 1 ? '' : 's'} added</span>}</div>
    <input ref={input} id="document-upload" type="file" accept="application/pdf,.pdf" multiple className="sr-only" aria-label="Upload PDF documents" disabled={busy} onChange={event => { onFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }}/>
    <div className={`upload-area ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) onFiles(Array.from(event.dataTransfer.files)); }}>
      <span className="upload-icon"><Upload size={23} strokeWidth={1.5}/></span><p>Drop your shipment PDFs here</p><span className="muted small">Commercial invoice, packing list, and bill of lading</span><Button variant="outline" size="sm" className="mt-5" onClick={() => input.current?.click()} disabled={busy}><Plus/> Add PDFs</Button><span className="upload-footnote">PDF files only</span>
    </div>
    {documents.length > 0 && <div className="document-list">{documents.map(doc => <div className="document-row" key={doc.id}><span className="pdf-icon"><FileText size={20} strokeWidth={1.4}/><span>PDF</span></span><div className="document-details"><p title={doc.name}>{doc.name}</p><span>{doc.type} · {doc.size < 1024 * 1024 ? `${Math.max(1, Math.round(doc.size / 1024))} KB` : `${(doc.size / (1024 * 1024)).toFixed(1)} MB`}</span><span className="document-state">{busy ? 'Processing' : 'Added'}</span></div><Button variant="ghost" size="icon" onClick={() => onRemove(doc.id)} disabled={busy} aria-label={`Remove ${doc.name}`} title="Remove document"><X size={14}/></Button></div>)}</div>}
    <div className="process-area"><Button className="process-button" onClick={onProcess} disabled={busy || !realCount}>{busy ? <Loader2 className="animate-spin"/> : null}{busy ? 'Extracting shipment data' : 'Extract shipment data'}{!busy && <ArrowRight/>}</Button>{busy && <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}<p>Nothing is filed or submitted.</p></div>
    {error && <div className="inline-error" role="alert">{error}</div>}
  </section>;
}
