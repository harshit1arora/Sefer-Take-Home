import { Pencil, Check, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ShipmentLine } from '@/features/entry/models';
import { formatMoney, formatNumber } from './ShipmentSummary';

export function LineItemTable({
  lines,
  editing,
  onEditing,
  onChange,
  onAdd,
  onRemove,
}: {
  lines: ShipmentLine[];
  editing: boolean;
  onEditing: (value: boolean) => void;
  onChange: (id: string, key: keyof ShipmentLine, value: string | number | null) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const fields = ['style', 'description', 'hsCode', 'quantity', 'unitPrice', 'amount', 'origin'] as const;
  const numeric = ['quantity', 'unitPrice', 'amount'];
  const commercial = lines.filter(line => !line.freeOfCharge);

  return (
    <section className="line-items" aria-labelledby="lines-heading">
      <div className="section-heading">
        <h2 id="lines-heading">
          Invoice lines <span className="count">{lines.length.toString().padStart(2, '0')}</span>
        </h2>
        <Button variant="ghost" size="sm" onClick={() => onEditing(!editing)}>
          {editing ? <Check /> : <Pencil />}
          {editing ? 'Done editing' : 'Edit line items'}
        </Button>
      </div>
      <div className="table-scroll">
        <table className={`line-table ${editing ? 'editing' : ''}`}>
          <thead>
            <tr>
              <th>Style / description</th>
              <th>HS / HTSUS</th>
              <th className="numeric">Qty</th>
              <th className="numeric">Unit price</th>
              <th className="numeric">Amount</th>
              <th>Origin</th>
              {editing && <th><span className="sr-only">Remove</span></th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.id}>
                <td>
                  {editing ? (
                    <>
                      <input
                        aria-label={`Line ${index + 1} style`}
                        value={line.style ?? ''}
                        onChange={event => onChange(line.id, 'style', event.target.value)}
                      />
                      <input
                        aria-label={`Line ${index + 1} description`}
                        value={line.description}
                        onChange={event => onChange(line.id, 'description', event.target.value)}
                      />
                    </>
                  ) : (
                    <>
                      <strong>{line.style || 'Unstyled'}</strong>
                      <br />
                      <span className="muted">{line.description}</span>
                    </>
                  )}
                </td>
                {fields.slice(2).map(key => (
                  <td key={key} className={numeric.includes(key) ? 'numeric' : ''}>
                    {editing ? (
                      <input
                        aria-label={`Line ${index + 1} ${key}`}
                        value={line[key] ?? ''}
                        type={numeric.includes(key) ? 'number' : 'text'}
                        min={0}
                        step={key === 'quantity' ? '1' : '0.01'}
                        onChange={event => {
                          const value = event.target.value;
                          if (!numeric.includes(key)) {
                            onChange(line.id, key, value);
                          } else if (value === '' && key !== 'quantity') {
                            onChange(line.id, key, null);
                          } else {
                            onChange(line.id, key, Math.max(0, Number(value)));
                          }
                        }}
                      />
                    ) : key === 'unitPrice' || key === 'amount' ? (
                      line[key] === null ? <span className="not-supplied">Not provided</span> : formatMoney(line[key])
                    ) : key === 'quantity' ? (
                      `${formatNumber(line.quantity)} ${line.unit ?? 'PCS'}`
                    ) : key === 'hsCode' && !line.hsCode ? (
                      <span className="missing-value">Code missing</span>
                    ) : (
                      line[key]
                    )}
                  </td>
                ))}
                {editing && (
                  <td>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemove(line.id)}
                      aria-label={`Remove line ${index + 1}`}
                      title="Remove line"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {!lines.length && (
              <tr>
                <td colSpan={editing ? 7 : 6} className="empty-table">No line items yet.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Commercial lines (free-of-charge samples excluded)</td>
              <td className="numeric">
                {formatNumber(commercial.reduce((sum, line) => sum + line.quantity, 0))}
              </td>
              <td />
              <td className="numeric">
                {formatMoney(commercial.reduce((sum, line) => sum + (line.amount ?? 0), 0))}
              </td>
              <td colSpan={editing ? 2 : 1} />
            </tr>
          </tfoot>
        </table>
      </div>
      {editing && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onAdd}>
          <Plus /> Add line
        </Button>
      )}
      <p className="table-note">
        Amounts are the values printed on the documents. Edits are sent to the backend with the next XML
        generation and recorded; the extracted source values are preserved. Enter a 10-digit HTSUS
        number only if a broker has approved it.
      </p>
    </section>
  );
}
