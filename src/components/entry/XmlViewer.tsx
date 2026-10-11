import { useState } from 'react';
import { Copy, Download, Check, Code2, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { EntryResponse } from '@/features/entry/models';
import { ValidationStatus } from './ValidationStatus';
export function XmlViewer({ entry, stale, busy, onGenerate }: { entry: EntryResponse | null; stale: boolean; busy: boolean; onGenerate: () => void }) {
  const [copied, setCopied] = useState(false); const [error, setError] = useState('');
  async function copy() { if (!entry) return; try { await navigator.clipboard.writeText(entry.xml); setCopied(true); setTimeout(() => setCopied(false), 2200); } catch { setError('Copy is unavailable in this browser. Download the XML instead.'); } }
  function download() { if (!entry) return; const blob = new Blob([entry.xml], { type: 'application/xml' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${entry.shipment.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '-')}-entry-DRAFT.xml`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const readiness = entry?.readiness;
  if (!entry) return null;
  return <section className="xml-section" aria-labelledby="xml-heading"><div className="section-heading"><div><span className="eyebrow">STEP 4</span><h2 id="xml-heading">Entry XML</h2></div><div className="xml-actions">{stale && <Button variant="outline" size="sm" onClick={onGenerate} disabled={busy}><RotateCw/> Regenerate XML</Button>}<Button variant="outline" size="sm" onClick={copy} disabled={stale}>{copied ? <Check/> : <Copy/>}{copied ? 'Copied' : 'Copy XML'}</Button><Button variant="default" size="sm" onClick={download} disabled={stale}><Download/> Download XML</Button></div></div>
    <div className="xml-validation" aria-label="Backend validation results"><strong>Validation</strong><ValidationStatus validation={entry.validation}/></div>
    <div className="code-panel"><div className="code-toolbar"><span><Code2 size={14}/>entry.xml</span><span>{stale ? 'Out of date · regenerate required' : readiness && !readiness.readyToFile ? 'Draft · not ready to file' : 'Draft · broker review required'}</span></div><pre tabIndex={0} aria-label="Entry XML code"><code>{entry.xml.split('\n').map((line, index) => <span className="code-line" key={index}><span className="line-number" aria-hidden="true">{index + 1}</span><span className={line.trim().startsWith('<!--') ? 'xml-comment' : 'xml-code'}>{line}</span></span>)}</code></pre></div>
    <p className="xml-disclosure">{stale ? 'Shipment details or broker decisions changed. Regenerate to refresh this draft.' : readiness && !readiness.readyToFile ? `Not ready to file · ${readiness.blockingMissing} required input(s), ${readiness.unconfirmedAssumptions} assumption(s), ${readiness.pendingSuggestions} suggestion(s), ${readiness.documentErrors} document issue(s) remain.` : 'Broker review is required before filing.'} No submission is made to NetCHB or CBP.</p>{error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
