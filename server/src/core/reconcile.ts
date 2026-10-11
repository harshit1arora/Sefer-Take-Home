import type { Finding, Shipment } from "./types.ts";
import { sanitizeInvoiceNo, toIso2 } from "./normalize.ts";

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** ISO 6346 container check digit */
export function iso6346Valid(c: string): boolean {
  const s = c.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{4}\d{7}$/.test(s)) return false;
  const val: Record<string, number> = {};
  let v = 10;
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") { if (v % 11 === 0) v++; val[ch] = v++; }
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (i < 4 ? val[s[i]] : Number(s[i])) * 2 ** i;
  return (sum % 11) % 10 === Number(s[10]);
}

export function reconcile(s: Shipment): Finding[] {
  const f: Finding[] = [];
  const add = (severity: Finding["severity"], code: string, message: string) => f.push({ severity, code, message });
  const { invoice: inv, packing: pl, bol } = s;
  const paid = inv.lines.filter((l) => !l.isFreeOfCharge);

  const printedSum = r2(paid.reduce((n, l) => n + l.statedAmount, 0));
  const recomputedSum = r2(paid.reduce((n, l) => n + r2(l.quantity * l.unitPrice), 0));
  for (const l of paid) {
    const calc = r2(l.quantity * l.unitPrice);
    if (Math.abs(calc - l.statedAmount) <= 0.005) continue;
    const ev: string[] = [];
    if (inv.statedFobTotal !== undefined && Math.abs(inv.statedFobTotal - recomputedSum) <= 0.005 && Math.abs(inv.statedFobTotal - printedSum) > 0.005)
      ev.push(`the invoice's own FOB total (${inv.statedFobTotal.toFixed(2)}) equals the sum of quantity x price (${recomputedSum.toFixed(2)}) and not the sum of printed line amounts (${printedSum.toFixed(2)})`);
    const impliedPrice = r2(l.statedAmount / l.quantity);
    add("error", "LINE_AMOUNT", `Invoice line ${l.lineNo} (${l.style}): printed amount ${l.statedAmount.toFixed(2)} but ${l.quantity} x ${l.unitPrice} = ${calc.toFixed(2)} (difference ${r2(calc - l.statedAmount).toFixed(2)}). `
      + `The printed amount is kept unchanged in the entered value; the difference is only a SUGGESTED correction until a broker approves it. `
      + (ev.length ? `Supporting evidence in the same invoice: ${ev.join("; ")}. ` : "No other figure on the invoice resolves it. ")
      + `Alternative reading: a unit price of ${impliedPrice} would reproduce the printed amount${ev.length ? ", but the invoice's totals do not support that" : ""}. Confirm against the payment record or ask the shipper.`);
  }
  if (inv.statedFobTotal !== undefined) {
    if (Math.abs(inv.statedFobTotal - printedSum) > 0.005)
      add("warn", "INVOICE_PRINTED_SUM", `Sum of printed line amounts (${printedSum.toFixed(2)}) differs from the invoice's printed FOB total (${inv.statedFobTotal.toFixed(2)}); the sum of quantity x price is ${recomputedSum.toFixed(2)}.`);
    else add("info", "INVOICE_PRINTED_SUM_OK", `Sum of printed line amounts equals the printed FOB total (${printedSum.toFixed(2)}).`);
  }
  if (inv.statedTotal !== undefined && inv.freight !== undefined && inv.insurance !== undefined) {
    const base = inv.statedFobTotal ?? recomputedSum, cif = r2(base + inv.freight + inv.insurance);
    if (Math.abs(cif - inv.statedTotal) > 0.005)
      add("warn", "INVOICE_TOTAL", `Printed FOB total + freight + insurance = ${cif.toFixed(2)}; invoice states ${inv.statedTotal.toFixed(2)}.`);
    else add("info", "INVOICE_TOTAL_OK", `Printed FOB total + freight + insurance = ${cif.toFixed(2)}, matching the printed CIF total. This says the invoice totals are internally consistent; it does not say which line figure is right.`);
  }

  const focQty = inv.lines.filter((l) => l.isFreeOfCharge).reduce((a, l) => a + l.quantity, 0);
  for (const l of inv.lines) {
    const p = pl.lines.find((x) => x.style === l.style);
    if (!p) { add("warn", "STYLE_MISSING_PL", `Style ${l.style} is not on the packing list.`); continue; }
    if (p.pcs !== l.quantity) {
      const diff = l.quantity - p.pcs;
      add("error", "QTY_MISMATCH", `${l.style}: invoice ${l.quantity} vs packing list ${p.pcs} (difference ${diff}).`);
      if (focQty && diff === focQty)
        add("info", "QTY_HYPOTHESIS", `The ${diff}-piece difference equals the free-of-charge sample quantity (${focQty}). Possible explanation: the invoice counted samples in this style. This is a hypothesis; confirm with the shipper.`);
    }
  }
  if (pl.cartons !== bol.packages) add("error", "PKG_MISMATCH", `Packing list ${pl.cartons} cartons vs B/L ${bol.packages}.`);
  if (Math.abs(pl.grossKg - bol.grossKg) > 0.5)
    add("warn", "WEIGHT_MISMATCH", `Gross weight: packing list ${pl.grossKg} kg vs B/L ${bol.grossKg} kg (difference ${r2(bol.grossKg - pl.grossKg)} kg). The B/L figure is used; confirm.`);

  for (const c of bol.containers) {
    if (!iso6346Valid(c.number)) add("error", "CONTAINER_CHECK", `Container ${c.number} fails the ISO 6346 check digit (possible OCR or handwriting error).`);
    if (c.printedNumber && c.printedNumber.replace(/\s/g, "") !== c.number.replace(/\s/g, "")) {
      const pv = iso6346Valid(c.printedNumber), cv = iso6346Valid(c.number);
      add("warn", "CONTAINER_CORRECTED", `The B/L printed container number ${c.printedNumber} (check digit ${pv ? "valid" : "INVALID"}) but it is corrected by hand to ${c.number} (check digit ${cv ? "valid" : "INVALID"}). `
        + `${c.correctionNote ? c.correctionNote + " " : ""}The corrected number is used; confirm it with the carrier before filing.`);
    }
  }
  if (!bol.containers.length) add("warn", "NO_CONTAINER", "No container number found on the B/L.");

  const origins = new Set(inv.lines.map((l) => toIso2(l.originCountry) ?? l.originCountry));
  if (origins.size > 1)
    add("warn", "MIXED_ORIGIN", `Several countries of origin on one invoice (${[...origins].join(", ")}). Each line carries its own origin and manufacturer; check the invoice's blanket origin declaration and the "Made in" carton marks.`);

  for (const l of inv.lines) {
    if (l.isFreeOfCharge) add("info", "FOC", `Line ${l.lineNo} (${l.style}) is free of charge; entered at the stated customs value ${l.customsValue ?? "(none)"}. Sample treatment (for example HTSUS 9811.00.60 when marked or valued at $1 or less) needs broker review.`);
    if (l.assistValue) add("warn", "ASSIST", `Line ${l.lineNo} (${l.style}): buyer-supplied material worth ${l.assistValue.toFixed(2)} is stated only in an invoice note, not in the invoice amount. It is kept separate and excluded from the entered value until a broker approves it (assists: 19 U.S.C. 1401a(h)(1)(A); amount and added costs need confirmation).`);
  }
  if (inv.incoterm?.toUpperCase().startsWith("CIF"))
    add("info", "CIF_DEDUCT", "CIF terms: international freight and insurance are excluded from the entered value.");

  const inNo = sanitizeInvoiceNo(inv.number);
  if (inNo.changed) add("warn", "INVOICE_NO_CHARS", `Invoice number "${inv.number}" contains characters NetCHB does not accept (allowed: letters, digits, hyphen, max 17). Submitted as "${inNo.value}"; keep a mapping.`);

  for (const l of inv.lines)
    if (!l.hts || l.hts.replace(/\D/g, "").length < 10)
      add("error", "HTS10_MISSING", `Line ${l.lineNo} (${l.style}): only ${l.hts ?? "no"} HS code on the documents; a 10-digit HTSUS number is required for filing. Not guessed.`);

  for (const n of s.extractionNotes ?? []) add("warn", "EXTRACTION_NOTE", `Extraction note: ${n}`);
  const plPcs = pl.lines.reduce((a, x) => a + x.pcs, 0), invPcs = inv.lines.reduce((a, l) => a + l.quantity, 0);
  if (plPcs !== invPcs) add("info", "TOTAL_PCS", `Total pieces: packing list ${plPcs} vs invoice ${invPcs}.`);
  return f;
}
