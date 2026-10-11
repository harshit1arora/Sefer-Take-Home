import { Circle, CircleAlert, Check } from 'lucide-react';
import { validationLabel, type EntryResponse } from '@/features/entry/models';
export function ValidationStatus({ validation }: { validation: EntryResponse['validation'] }) {
  return <div className="validation-status">{([['syntax', 'XML syntax'], ['xsd', 'XSD schema']] as const).map(([key, label]) => {
    const check = validation[key];
    // A pass only counts as fully confirmed when the backend ran it and, for the XSD, used the complete schema.
    const confirmed = check.status === 'passed' && check.confirmedByBackend && check.complete !== false;
    const partial = check.status === 'passed' && check.confirmedByBackend && check.complete === false;
    return <div key={key}><div className="validation-item"><span className={confirmed ? 'confirmed-status' : 'muted'}>{confirmed ? <Check size={14}/> : check.status === 'failed' ? <CircleAlert size={14}/> : <Circle size={12}/>}</span><span>{label}</span><span className={confirmed ? 'confirmed-status' : 'validation-value'} title={check.message}>{validationLabel(check)}</span></div>
      {partial && <p className="validation-detail">Bundled schema subset only; not the full official schema.</p>}
      {check.status === 'failed' && check.message && <pre className="validation-errors" aria-label={`${label} errors`}>{check.message}</pre>}
      {check.status === 'unavailable' && check.message && <p className="validation-detail">{check.message}</p>}
    </div>;
  })}</div>;
}
