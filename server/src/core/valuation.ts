import type { Approvals, LineValuation, Shipment, ValueComponent, Valuation } from "./types.ts";
import { r2 } from "./reconcile.ts";
import { ensureLineIds } from "./lineIds.ts";

/** Approvals are keyed by the line's STABLE id, never by the (repeatable) style code. */
const approvedFor = (list: string[] | "all" | undefined, lineId: string) => list === "all" || (Array.isArray(list) && list.includes(lineId));

/**
 * Entered value is built ONLY from components that are either printed on the documents (source) or explicitly
 * approved by a broker. Suggested corrections and the assist are listed with their effect but excluded until approved.
 * The printed invoice amount is never overwritten.
 */
export function computeValuation(s: Shipment, a: Approvals = {}): Valuation {
  const inv = ensureLineIds(s).invoice;
  const lines: LineValuation[] = inv.lines.map((l) => {
    const c: ValueComponent[] = [];
    if (l.isFreeOfCharge) {
      // If customsValue was extracted as per-unit (matching unitPrice) while quantity > 1, compute total;
      // otherwise use customsValue as total line amount, falling back to statedAmount.
      const rawCustoms = l.customsValue ?? l.statedAmount;
      const totalCustoms = (l.customsValue !== undefined && l.quantity > 1 && Math.abs(l.customsValue - l.unitPrice) < 0.005 && l.statedAmount > l.customsValue)
        ? r2(l.customsValue * l.quantity)
        : rawCustoms;
      c.push({ id: "foc-customs-value", label: "Customs value printed for free-of-charge samples", amount: totalCustoms,
        provenance: "source", included: true, basis: `Invoice line ${l.lineNo}: "value for customs purpose only"${l.quantity > 0 ? ` (${l.quantity} x ${Math.round((totalCustoms / l.quantity) * 100) / 100})` : ""}. No commercial value; valuation and any 9811.00.60 treatment are broker decisions.` });
    } else {
      const overridden = l.amountOverride !== undefined;
      c.push({ id: "invoice-amount", label: l.addedByBroker ? "Amount entered by broker (line not on the documents)" : "Invoice line amount as printed", amount: l.statedAmount,
        provenance: l.addedByBroker ? "broker_approved" : "source", included: !overridden,
        basis: l.addedByBroker ? "Line added by a broker in the workspace; not extracted from any document." : overridden ? `Invoice line ${l.lineNo}, Amount USD column, unchanged from the document. Not used: replaced by the broker override below.` : `Invoice line ${l.lineNo}, Amount USD column, unchanged from the document.` });
      if (overridden) c.push({ id: "broker-override", label: `Broker override of the line amount (printed ${l.statedAmount.toFixed(2)})`, amount: r2(l.amountOverride!),
        provenance: "broker_approved", included: true, basis: "Entered by a broker in the workspace; recorded as an edit. The printed amount is preserved above." });
      const calc = r2(l.quantity * l.unitPrice), delta = r2(calc - l.statedAmount);
      if (!overridden && Math.abs(delta) > 0.005) {
        const ok = approvedFor(a.acceptRecomputedAmounts, l.id ?? "");
        c.push({ id: "recomputed-delta", label: `Proposed correction to quantity x unit price (${l.quantity} x ${l.unitPrice} = ${calc.toFixed(2)})`, amount: delta,
          provenance: ok ? "broker_approved" : "suggested", included: ok,
          basis: ok ? "Approved by broker." : "Suggested only. Printed amount and quantity x price disagree; see the finding for the evidence. Which figure was actually paid or payable must be confirmed (for example against the payment record)." });
      }
      if (l.assistValue) {
        const ok = approvedFor(a.acceptAssist, l.id ?? "");
        c.push({ id: "assist", label: "Buyer-supplied material (assist)", amount: l.assistValue, provenance: ok ? "broker_approved" : "suggested", included: ok,
          basis: ok ? "Approved by broker. Amount is the figure stated in the invoice note." : "Suggested only. Invoice note states USD " + l.assistValue.toFixed(2) + " of free fabric. Free materials incorporated in the goods are generally assists (19 U.S.C. 1401a(h)(1)(A)); amount and any added costs need broker confirmation. Kept separate from the invoice amount." });
      }
    }
    return { id: l.id ?? `L${l.lineNo}`, lineNo: l.lineNo, style: l.style, components: c,
      value: r2(c.filter((x) => x.included).reduce((n, x) => n + x.amount, 0)),
      valueIfAllSuggestionsAccepted: r2(c.filter((x) => x.included || x.provenance === "suggested").reduce((n, x) => n + x.amount, 0)) };
  });
  const excluded: Valuation["excluded"] = [];
  if (inv.freight) excluded.push({ label: "International freight", amount: inv.freight, why: "CIF sale: international freight is not part of the entered value. Invoice lines are priced FOB (the invoice totals them as 'TOTAL FOB VALUE')." });
  if (inv.insurance) excluded.push({ label: "Marine insurance", amount: inv.insurance, why: "CIF sale: international insurance is not part of the entered value." });
  return { lines, excluded,
    entered: r2(lines.reduce((n, x) => n + x.value, 0)),
    enteredIfAllSuggestionsAccepted: r2(lines.reduce((n, x) => n + x.valueIfAllSuggestionsAccepted, 0)),
    pending: lines.reduce((n, x) => n + x.components.filter((y) => y.provenance === "suggested").length, 0),
    method: "Sum of source-printed amounts plus broker-approved components only. Freight and insurance excluded (CIF). Duty is not calculated." };
}
