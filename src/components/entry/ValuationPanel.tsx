import type { BrokerForm, BrokerLineEvidence, EntryResponse } from '@/features/entry/models';
import { formatMoney } from './ShipmentSummary';

const provenanceLabel = { source: 'SOURCE', derived: 'DERIVED', suggested: 'SUGGESTED', broker_approved: 'BROKER-APPROVED' } as const;
const statusLabel = { verified: 'verified', derived: 'derived', assumed: 'assumed', broker_confirm: 'broker to confirm', broker_approved: 'broker-approved', broker_supplied: 'broker-supplied' } as const;
const brokerFields: { key: Exclude<keyof BrokerForm, 'lineEvidence'>; label: string; hint: string }[] = [
  { key: 'importerTaxId', label: 'Importer of record tax ID', hint: 'e.g. 12-3456789' },
  { key: 'processingPort', label: 'Processing port (4 digits)', hint: 'Broker’s Schedule D code' },
  { key: 'entryPort', label: 'Entry port (4 digits)', hint: 'Blank = discharge port, assumed' },
  { key: 'suretyCode', label: 'Surety code', hint: 'Bond surety' },
  { key: 'entryType', label: 'Entry type', hint: 'Blank = 01, assumed' },
  { key: 'locationOfGoods', label: 'Location of goods (FIRMS)', hint: 'Optional' },
];

/** Approvals are per component and explicit. Nothing suggested enters the entered value until it is ticked and the XML regenerated. */
export function ValuationPanel({ entry, approved, onApprove, broker, onBroker, onLineEvidence, disabled }: {
  entry: EntryResponse; approved: Record<string, boolean>; onApprove: (key: string, value: boolean) => void;
  broker: BrokerForm; onBroker: (key: Exclude<keyof BrokerForm, 'lineEvidence'>, value: string) => void;
  onLineEvidence: (lineId: string, field: keyof BrokerLineEvidence, value: string | boolean) => void; disabled: boolean;
}) {
  const v = entry.valuation;
  return <section className="valuation-section" aria-labelledby="valuation-heading" id="valuation-section">
    <div className="section-heading"><div><span className="eyebrow">VALUATION AND BROKER INPUTS</span><h2 id="valuation-heading">Entered value and approvals</h2></div>{v && <span className="section-meta">{v.pending} suggested · {formatMoney(v.entered)} entered</span>}</div>
    {v ? <>
      <p className="valuation-intro">{v.method} Printed values are never changed. Suggested components are excluded until a broker approves them and the XML is regenerated. If every suggestion were accepted the total would be {formatMoney(v.enteredIfAllSuggestionsAccepted)}.</p>
      <div className="valuation-lines">{v.lines.map(line => <div className="valuation-line" key={line.lineNo}>
        <div className="valuation-line-head"><strong>{line.style}</strong><span>{formatMoney(line.value)}</span></div>
        {line.components.map(c => { const key = `${line.style}:${c.id}`; const approvable = c.id === 'recomputed-delta' || c.id === 'assist';
          return <div className={`valuation-component ${c.included ? '' : 'is-excluded'}`} key={c.id}>
            <span className={`provenance-tag ${c.provenance}`}>{provenanceLabel[c.provenance]}</span>
            <div><p>{c.label}: <strong>{formatMoney(c.amount)}</strong> <span className="muted">{c.included ? '· included' : '· not included'}</span></p><small>{c.basis}</small>
              {approvable && <label className="approve-row"><input type="checkbox" checked={Boolean(approved[key])} disabled={disabled} onChange={event => onApprove(key, event.target.checked)}/> Broker approves including this component ({formatMoney(c.amount)})</label>}</div>
          </div>; })}
      </div>)}</div>
      {v.excluded.length > 0 && <ul className="valuation-excluded">{v.excluded.map(x => <li key={x.label}><strong>Excluded: {x.label} {formatMoney(x.amount)}.</strong> <span className="muted">{x.why}</span></li>)}</ul>}
    </> : <p className="valuation-intro">The backend did not return a valuation breakdown.</p>}
    <div id="broker-inputs"><h3 className="eyebrow">BROKER INPUTS (NOT ON THE DOCUMENTS)</h3>
      <div className="form-grid">{brokerFields.map(f => <label className="form-field" key={f.key}>{f.label}<input value={broker[f.key]} placeholder={f.hint} disabled={disabled} maxLength={40} onChange={event => onBroker(f.key, event.target.value)}/></label>)}</div>
      <p className="valuation-intro">Values are used as typed and checked only by the XSD. HTSUS numbers are entered per line in the invoice-line table. Nothing here is inferred.</p></div>
    <div className="valuation-lines"><h3 className="eyebrow">LINE EVIDENCE (BROKER SUPPLIED)</h3>{entry.shipment.lines.map(line => {
      const evidence = broker.lineEvidence[line.id] ?? { manufacturerId: { value: '', approved: false }, countryOfExport: { value: '', approved: false } };
      return <div className="valuation-line" key={line.id}><div className="valuation-line-head"><strong>{line.style ?? line.id}</strong><span>Origin: {line.origin || 'not stated'}</span></div><div className="form-grid">
        <label className="form-field">Manufacturer ID<input value={evidence.manufacturerId.value} placeholder="Source or broker record" disabled={disabled} maxLength={30} onChange={event => onLineEvidence(line.id, 'manufacturerId', event.target.value)}/><span className="approve-row"><input type="checkbox" checked={evidence.manufacturerId.approved} disabled={disabled || !evidence.manufacturerId.value.trim()} onChange={event => onLineEvidence(line.id, 'manufacturerId', event.target.checked)}/> Broker approves this ID</span></label>
        <label className="form-field">Country of export<input value={evidence.countryOfExport.value} placeholder="ISO-2, e.g. BD" disabled={disabled} maxLength={2} onChange={event => onLineEvidence(line.id, 'countryOfExport', event.target.value)}/><span className="approve-row"><input type="checkbox" checked={evidence.countryOfExport.approved} disabled={disabled || !evidence.countryOfExport.value.trim()} onChange={event => onLineEvidence(line.id, 'countryOfExport', event.target.checked)}/> Broker approves this country</span></label>
      </div></div>;
    })}</div>
    {entry.assumptions && entry.assumptions.length > 0 && <details className="assumption-list"><summary>Assumptions and derived values ({entry.assumptions.length})</summary>
      <ul>{entry.assumptions.map((a, i) => <li key={`${a.field}-${i}`}><strong>{a.field}</strong> = {a.value} <span className="muted">[{statusLabel[a.status]}]</span><br/><small>{a.basis}</small></li>)}</ul></details>}
  </section>;
}
