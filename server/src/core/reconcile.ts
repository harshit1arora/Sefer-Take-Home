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
    const impliedPrice = l.quantity > 0 ? r2(l.statedAmount / l.quantity) : undefined;
    add("error", "LINE_AMOUNT", `Invoice line ${l.lineNo} (${l.style}): printed amount ${l.statedAmount.toFixed(2)} but ${l.quantity} x ${l.unitPrice} = ${calc.toFixed(2)} (difference ${r2(calc - l.statedAmount).toFixed(2)}). `
      + `The printed amount is kept unchanged in the entered value; the difference is only a SUGGESTED correction until a broker approves it. `
      + (ev.length ? `Supporting evidence in the same invoice: ${ev.join("; ")}. ` : "No other figure on the invoice resolves it. ")
      + (impliedPrice !== undefined
          ? `Alternative reading: a unit price of ${impliedPrice} would reproduce the printed amount${ev.length ? ", but the invoice's totals do not support that" : ""}. `
          : `The line quantity is not positive, so no alternative unit price can be computed. `)
      + `Confirm against the payment record or ask the shipper.`);
  }
  if (inv.statedFobTotal !== undefined) {
    if (Math.abs(inv.statedFobTotal - printedSum) > 0.005)
      add("warn", "INVOICE_PRINTED_SUM", `Sum of printed line amounts (${printedSum.toFixed(2)}) differs from the invoice's printed FOB total (${inv.statedFobTotal.toFixed(2)}); the sum of quantity x price is ${recomputedSum.toFixed(2)}.`);
    else add("info", "INVOICE_PRINTED_SUM_OK", `Sum of printed line amounts equals the printed FOB total (${printedSum.toFixed(2)}).`);
  }
  if (inv.statedTotal !== undefined) {
    const base = inv.statedFobTotal ?? recomputedSum;
    const freight = inv.freight ?? 0;
    const insurance = inv.insurance ?? 0;
    const calculatedTotal = r2(base + freight + insurance);
    const components: string[] = [];
    if (inv.statedFobTotal !== undefined) components.push("FOB total");
    else components.push("sum of lines");
    if (inv.freight !== undefined) components.push("freight");
    if (inv.insurance !== undefined) components.push("insurance");

    if (Math.abs(calculatedTotal - inv.statedTotal) > 0.005) {
      add("warn", "INVOICE_TOTAL", `Calculated total (${components.join(" + ")}) = ${calculatedTotal.toFixed(2)}; invoice states grand total ${inv.statedTotal.toFixed(2)}.`);
    } else {
      add("info", "INVOICE_TOTAL_OK", `Calculated total (${components.join(" + ")}) = ${calculatedTotal.toFixed(2)}, matching the printed invoice grand total (${inv.statedTotal.toFixed(2)}).`);
    }
  }

  // Compare AGGREGATED quantities per normalised style. A style code can legitimately repeat on several invoice
  // lines (or several packing-list lines), so a per-line first-match lookup would invent variant-level matches.
  const normStyle = (x: string) => x.trim().toUpperCase();
  const focQty = inv.lines.filter((l) => l.isFreeOfCharge).reduce((a, l) => a + l.quantity, 0);
  const invByStyle = new Map<string, { qty: number; label: string; lines: number[] }>();
  for (const l of inv.lines) {
    const k = normStyle(l.style);
    const e = invByStyle.get(k) ?? { qty: 0, label: l.style, lines: [] };
    e.qty += l.quantity; e.lines.push(l.lineNo);
    invByStyle.set(k, e);
  }
  const plByStyle = new Map<string, { pcs: number; label: string }>();
  for (const p of pl.lines) {
    const k = normStyle(p.style);
    const e = plByStyle.get(k) ?? { pcs: 0, label: p.style };
    e.pcs += p.pcs;
    plByStyle.set(k, e);
  }
  const countUnits = new Set(["PCS", "PC", "PIECES", "PIECE", "EA", "EACH", "UNITS", "UNIT", "ITEMS", "ITEM"]);
  const isCountUnit = (u?: string) => !u || countUnits.has(u.trim().toUpperCase());

  for (const [k, agg] of invByStyle) {
    const plAgg = plByStyle.get(k);
    if (!plAgg) { add("warn", "STYLE_MISSING_PL", `Style ${agg.label} is not on the packing list.`); continue; }
    
    // Compare quantities only when their units are compatible
    const stylesLines = inv.lines.filter(l => normStyle(l.style) === k);
    const incompatibleUnits = stylesLines.filter(l => !isCountUnit(l.unit));
    if (incompatibleUnits.length) {
      const unitsList = [...new Set(incompatibleUnits.map(l => l.unit))].join(", ");
      add("warn", "UNIT_INCOMPATIBLE", `Style ${agg.label}: invoice quantity is specified in ${unitsList} while packing list quantities are in pieces. Direct quantity comparison may be inaccurate.`);
      continue;
    }

    const diff = agg.qty - plAgg.pcs;
    if (diff !== 0) {
      const onLines = agg.lines.length > 1 ? ` (${agg.lines.length} invoice lines)` : "";
      add("error", "QTY_MISMATCH", `${agg.label}${onLines}: invoice ${agg.qty} vs packing list ${plAgg.pcs} (difference ${diff}).`);
      if (focQty && diff === focQty)
        add("info", "QTY_HYPOTHESIS", `The ${diff}-piece difference equals the free-of-charge sample quantity (${focQty}). Possible explanation: the invoice counted samples in this style. This is a hypothesis; confirm with the shipper.`);
    }
  }
  const pkgUnits = new Set(["CTN", "CTNS", "CARTON", "CARTONS", "BOX", "BOXES", "PKG", "PKGS", "PACKAGES", "PACKAGE"]);
  const isPkgUnit = (u?: string) => !u || pkgUnits.has(u.trim().toUpperCase());
  if (bol.packageUnit && !isPkgUnit(bol.packageUnit)) {
    add("warn", "PKG_UNIT_INCOMPATIBLE", `B/L package unit is '${bol.packageUnit}', while packing list counts cartons. Confirm packaging units.`);
  } else if (pl.cartons !== bol.packages) {
    add("error", "PKG_MISMATCH", `Packing list ${pl.cartons} cartons vs B/L ${bol.packages}${bol.packageUnit ? ` ${bol.packageUnit}` : ""}.`);
  }
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

  for (const l of inv.lines)
    if (l.originCountry === undefined)
      add("error", "ORIGIN_MISSING", `Line ${l.lineNo} (${l.style}): no country of origin is stated on any document. Country of origin is required for filing and is never inferred; set it from the documents or correct it in the workspace.`);
  const stated = inv.lines.filter((l) => l.originCountry !== undefined);
  const origins = new Set(stated.map((l) => toIso2(l.originCountry) ?? l.originCountry));
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
  if (!inNo.value) add("error", "INVOICE_NO_EMPTY", `Invoice number "${inv.number}" has no usable characters for the NetCHB invoiceNoType pattern [A-Za-z\\d\\-]{1,17}; an invoice element cannot be generated.`);
  if (inNo.truncated) add("error", "INVOICE_NO_TRUNCATED", `Invoice number "${inv.number}" is longer than the 17-character schema limit and was truncated to "${inNo.value}". Confirm the full value and check it cannot collide with another entry.`);

  const seenLineNos = new Set<number>(), seenStyles = new Map<string, number>();
  for (const l of inv.lines) {
    if (seenLineNos.has(l.lineNo)) add("error", "DUPLICATE_LINE_NO", `Invoice line number ${l.lineNo} appears more than once; line numbers must be unique.`);
    seenLineNos.add(l.lineNo);
    const key = l.style.trim().toUpperCase();
    seenStyles.set(key, (seenStyles.get(key) ?? 0) + 1);
  }
  for (const [style, n] of seenStyles) if (n > 1)
    add("info", "DUPLICATE_STYLE", `Style "${style}" appears on ${n} invoice lines. Repeated style codes on separate lines can be legitimate (different colours, sizes, origins or classifications), so this is informational: confirm the split is intended.`);

  for (const l of inv.lines)
    if (!(l.quantity > 0))
      add("error", "ZERO_QUANTITY", `Invoice line ${l.lineNo} (${l.style}) has a non-positive quantity (${l.quantity}); a line with no quantity is not usable and cannot be filed.`);

  for (const l of inv.lines)
    if (!l.hts || l.hts.replace(/\D/g, "").length < 10)
      add("error", "HTS10_MISSING", `Line ${l.lineNo} (${l.style}): only ${l.hts ?? "no"} HS code on the documents; a 10-digit HTSUS number is required for filing. Not guessed.`);

  // packing-list styles with no invoice line (the reverse of STYLE_MISSING_PL)
  for (const [k, agg] of plByStyle) if (!invByStyle.has(k))
    add("warn", "PL_STYLE_NOT_INVOICED", `Packing list style ${agg.label} (${agg.pcs} pcs) has no matching invoice line. Confirm whether the goods were invoiced under another style or were omitted from the invoice.`);

  // ---- logistics consistency
  const gross = bol.grossKg ?? pl.grossKg;
  if (pl.netKg !== undefined && gross !== undefined && pl.netKg > gross + 0.005)
    add("error", "NET_GT_GROSS", `Packing list net weight ${pl.netKg} kg is greater than the gross weight ${gross} kg; net weight cannot exceed gross weight.`);
  if (bol.onBoardDate && bol.etaDate && bol.etaDate < bol.onBoardDate)
    add("error", "ETA_BEFORE_ONBOARD", `The B/L ETA (${bol.etaDate}) is earlier than the on-board date (${bol.onBoardDate}); arrival cannot precede loading.`);
  const seenContainers = new Map<string, number>();
  for (const c of bol.containers) { const k = c.number.replace(/\s+/g, "").toUpperCase(); seenContainers.set(k, (seenContainers.get(k) ?? 0) + 1); }
  for (const [n, c] of seenContainers) if (c > 1) add("error", "DUPLICATE_CONTAINER", `Container number ${n} appears ${c} times; container numbers must be unique.`);

  // a genuine zero is different from unextracted data: flag zero counts instead of emitting them as verified
  if (!(bol.packages > 0)) add("error", "PACKAGES_ZERO", `Package count is ${bol.packages}; a shipment cannot have zero packages. Confirm the count from the B/L or packing list.`);
  if (!(gross > 0)) add("error", "GROSS_ZERO", `Gross weight is ${gross ?? "missing"}; a shipment cannot have zero gross weight. Confirm it from the B/L or packing list.`);

  // XML-invalid control characters in any text that reaches the XML
  const BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
  const texts: [string, string | undefined][] = [
    ["invoice number", inv.number], ["buyer name", inv.buyer?.name], ["seller name", inv.seller?.name],
    ["goods description", bol.goodsDescription], ["vessel name", bol.vessel], ["voyage number", bol.voyage],
    ...inv.lines.flatMap((l): [string, string][] => [[`line ${l.lineNo} style`, l.style], [`line ${l.lineNo} description`, l.description]]),
  ];
  for (const [label, v] of texts) if (v && BAD.test(v))
    add("warn", "CONTROL_CHARS", `The ${label} contains control characters that are not valid in XML; they were removed from the generated XML. Clean the source value.`);

  for (const n of s.extractionNotes ?? []) add("warn", "EXTRACTION_NOTE", `Extraction note: ${n}`);
  const plPcs = pl.lines.reduce((a, x) => a + x.pcs, 0), invPcs = inv.lines.reduce((a, l) => a + l.quantity, 0);
  if (plPcs !== invPcs) add("info", "TOTAL_PCS", `Total pieces: packing list ${plPcs} vs invoice ${invPcs}.`);
  return f;
}
