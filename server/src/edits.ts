import type { InvoiceLine, Shipment } from "./core/types.ts";
import { toIso2 } from "./core/normalize.ts";
import { toFrontendShipment, type FrontendShipment } from "./frontendShape.ts";

export interface EditRecord { scope: "summary" | "line"; target: string; field: string; original: string; edited: string }
/** `htsByStyle` maps a line's STABLE id (not its style code) to a broker-approved 10-digit HTSUS. */
export interface EditResult { working: Shipment; htsByStyle: Record<string, string>; edits: EditRecord[]; ignored: string[] }

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const digits = (s: string) => s.replace(/\D/g, "");
const fmt = (v: unknown) => (v === undefined || v === null || v === "" ? "(empty)" : String(v));

/**
 * Compares the shipment as edited in the workspace with the ORIGINAL extraction and applies the differences to a copy.
 * The original `source` is never mutated and printed amounts are never overwritten: an amount edit becomes
 * `amountOverride`, which valuation shows as a separate broker component next to the printed amount.
 */
export function applyEdits(source: Shipment, edited: FrontendShipment): EditResult {
  const base = toFrontendShipment(source);
  const working = structuredClone(source);
  const edits: EditRecord[] = [], ignored: string[] = [];
  const htsByStyle: Record<string, string> = {};
  const rec = (scope: EditRecord["scope"], target: string, field: string, original: unknown, now: unknown) =>
    edits.push({ scope, target, field, original: fmt(original), edited: fmt(now) });

  // ---- summary fields
  const text = (key: "invoiceNumber" | "buyer" | "consignee" | "billOfLading", apply: (v: string) => void) => {
    const now = edited[key].trim();
    if (now !== base[key]) { if (!now) { ignored.push(`${key} was cleared; the extracted value is kept.`); return; } apply(now); rec("summary", "shipment", key, base[key], now); }
  };
  text("invoiceNumber", (v) => { working.invoice.number = v; });
  text("buyer", (v) => { working.invoice.buyer = { ...working.invoice.buyer, name: v }; });
  text("consignee", (v) => { working.invoice.shipTo = { ...(working.invoice.shipTo ?? { name: v }), name: v }; });
  text("billOfLading", (v) => { working.bol.houseBill = v.replace(/\s+/g, ""); });
  const num = (key: "invoiceValue" | "freight" | "insurance" | "packages" | "grossWeight", apply: (v: number) => void) => {
    if (!same(edited[key], base[key])) { apply(edited[key]); rec("summary", "shipment", key, base[key], edited[key]); }
  };
  num("invoiceValue", (v) => { working.invoice.statedTotal = v; });
  num("freight", (v) => { working.invoice.freight = v; });
  num("insurance", (v) => { working.invoice.insurance = v; });
  num("packages", (v) => { working.bol.packages = Math.round(v); });
  num("grossWeight", (v) => { working.bol.grossKg = v; });
  if (edited.netWeight !== undefined && base.netWeight !== undefined && !same(edited.netWeight, base.netWeight)) { working.packing.netKg = edited.netWeight; rec("summary", "shipment", "netWeight", base.netWeight, edited.netWeight); }
  if (edited.volume !== undefined && base.volume !== undefined && !same(edited.volume, base.volume)) { working.packing.cbm = edited.volume; rec("summary", "shipment", "volume", base.volume, edited.volume); }
  if (edited.origin !== base.origin) ignored.push(`Country of origin ("${edited.origin}") is derived from the line items. Edit the origin on each line instead; the summary edit was not applied.`);
  if (edited.destination !== base.destination) ignored.push(`Destination port ("${edited.destination}") is derived from the documents; the summary edit was not applied.`);

  // ---- lines
  const editedById = new Map(edited.lines.map((l) => [l.id, l]));
  const baseById = new Map(base.lines.map((l) => [l.id, l]));
  const keep: InvoiceLine[] = [];
  for (const line of working.invoice.lines) {
    const id = line.id ?? `line-${line.lineNo}`, b = baseById.get(id)!, e = editedById.get(id);
    if (!e) { rec("line", b.style ?? id, "line", "present on the documents", "removed by broker"); continue; }
    const tgt = b.style ?? id;
    if ((e.style ?? "") !== (b.style ?? "")) { if ((e.style ?? "").trim()) { line.style = e.style!.trim(); rec("line", tgt, "style", b.style, line.style); } else ignored.push(`Line ${tgt}: an empty style was ignored.`); }
    if (e.description !== b.description) { line.description = e.description; rec("line", tgt, "description", b.description, e.description); }
    if (!same(e.quantity, b.quantity)) { line.quantity = e.quantity; rec("line", tgt, "quantity", b.quantity, e.quantity); }
    if (e.unitPrice !== b.unitPrice) {
      if (e.unitPrice === null) ignored.push(`Line ${tgt}: a cleared unit price was ignored.`);
      else { line.unitPrice = e.unitPrice; rec("line", tgt, "unitPrice", b.unitPrice, e.unitPrice); }
    }
    if (e.amount !== b.amount) {
      if (e.amount === null) ignored.push(`Line ${tgt}: a cleared amount was ignored.`);
      else if (!same(e.amount, line.statedAmount)) { line.amountOverride = e.amount; rec("line", tgt, "amount", line.statedAmount, e.amount); }
    }
    if (e.origin !== b.origin) {
      const iso = toIso2(e.origin);
      if (iso) { line.originCountry = iso; rec("line", tgt, "origin", b.origin, e.origin); } else ignored.push(`Line ${tgt}: origin "${e.origin}" is not a recognised country; the extracted origin is kept.`);
    }
    if (digits(e.hsCode) !== digits(b.hsCode) || (e.hsCode.trim() === "") !== (b.hsCode.trim() === "")) {
      const d = digits(e.hsCode);
      if (d.length === 10) { htsByStyle[id] = d; rec("line", tgt, "hsCode", b.hsCode, d); }
      else if (d.length >= 4) { line.hts = d; rec("line", tgt, "hsCode", b.hsCode, `${d} (not a 10-digit HTSUS; classification stays incomplete)`); }
      else if (e.hsCode.trim() !== "") ignored.push(`Line ${tgt}: "${e.hsCode}" is not a usable HS/HTSUS code and was ignored.`);
    }
    keep.push(line);
  }
  let nextNo = Math.max(0, ...source.invoice.lines.map((l) => l.lineNo)) + 1;
  let idCounter = source.invoice.lines.reduce((m, l) => { const g = /^L(\d+)$/.exec(l.id ?? ""); return g ? Math.max(m, Number(g[1])) : m; }, 0);
  const nextId = () => `L${++idCounter}`;
  for (const e of edited.lines.filter((l) => !baseById.has(l.id))) {
    const iso = toIso2(e.origin), label = e.style?.trim() || e.description.trim() || "(new line)";
    if (!(e.style?.trim() || e.description.trim()) || !iso || !(e.quantity > 0)) {
      ignored.push(`Added line "${label}" needs a style or description, a quantity above zero and a recognised origin. It was not added.`);
      continue;
    }
    const style = e.style?.trim() || `ADDED-${nextNo}`;
    const price = e.unitPrice ?? 0, amount = e.amount ?? Math.round(e.quantity * price * 100) / 100;
    const added: InvoiceLine = { id: nextId(), lineNo: nextNo++, style, description: e.description, quantity: e.quantity, unit: e.unit ?? "PCS", unitPrice: price,
      statedAmount: amount, originCountry: iso, isFreeOfCharge: false, addedByBroker: true };
    const d = digits(e.hsCode);
    if (d.length === 10) htsByStyle[added.id!] = d; else if (d.length >= 4) added.hts = d;
    keep.push(added); rec("line", style, "line", "not on the documents", `added by broker: ${e.quantity} x ${price} = ${amount}`);
  }
  working.invoice.lines = keep;
  return { working, htsByStyle, edits, ignored };
}
