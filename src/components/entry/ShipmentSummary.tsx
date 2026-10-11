import { Pencil, ArrowUpRight, Package, Scale, Globe2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Shipment } from '@/features/entry/models';
export const formatNumber = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
export const formatMoney = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
export function ShipmentSummary({ shipment, onEdit }: { shipment: Shipment | null; onEdit: () => void }) {
  return <section aria-labelledby="overview-heading"><div className="section-heading"><h2 id="overview-heading">Shipment overview</h2><Button variant="ghost" size="sm" onClick={onEdit} disabled={!shipment}><Pencil size={13}/> Edit details</Button></div>{shipment ? <>
    <div className="shipment-identity"><div><span className="eyebrow">INVOICE NUMBER</span><h3>{shipment.invoiceNumber || 'Not supplied'}</h3></div><span className="status-label"><span/>Broker review required</span></div>
    <dl className="summary-grid">{[['Buyer', shipment.buyer], ['Consignee', shipment.consignee], ['Country of origin', shipment.origin], ['Destination port', shipment.destination], ['Bill of lading', shipment.billOfLading]].map(([label, value]) => <div key={label} className={label === 'Bill of lading' ? 'wide-field' : ''}><dt>{label}</dt><dd>{value || 'Not supplied'}{label === 'Destination port' && <ArrowUpRight size={13}/>}</dd></div>)}</dl>
    <div className="value-grid">{[['Invoice value · CIF', formatMoney(shipment.invoiceValue)], ['Freight', formatMoney(shipment.freight)], ['Insurance', formatMoney(shipment.insurance)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="shipment-metrics"><span><Package size={14}/>{formatNumber(shipment.packages)} cartons</span><span><Scale size={14}/>{formatNumber(shipment.grossWeight)} kg gross{shipment.netWeight !== undefined ? ` · ${formatNumber(shipment.netWeight)} kg net` : ''}</span><span><Globe2 size={14}/>{shipment.volume !== undefined ? `${formatNumber(shipment.volume)} CBM` : `${shipment.lines.length} invoice lines`}</span></div>
  </> : <div className="empty-overview"><FileEmpty/><h3>Your next entry starts here.</h3><p>Add shipment PDFs, then process them to prepare a draft for review.</p></div>}</section>;
}
function FileEmpty() { return <Package size={28} strokeWidth={1.2}/>; }
