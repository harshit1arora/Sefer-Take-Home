import type { Assumption, BrokerInputs, BuildResult, MissingItem, Shipment } from "./types.ts";
import { cleanContainerNumber, foreignPort, normalizeContainerSize, sanitizeInvoiceNo, splitBill, toIso2, usPort } from "./normalize.ts";
import { buildMid } from "./mid.ts";
import { computeValuation } from "./valuation.ts";

const esc = (v: string | number) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tag = (n: string, v: string | number | undefined) => (v === undefined || v === "" ? "" : `<${n}>${esc(v)}</${n}>`);
const cm = (t: string) => `<!-- ${t.replace(/--/g, "-")} -->`;
const PLACEHOLDER_PORT = "0000";

/** Builds the uploadEntry XML following NetCHB entry.xsd element order. Deterministic: no LLM involved. */
export function buildEntry(s: Shipment, b: BrokerInputs = {}, opts: { today: string }): BuildResult {
  const A: Assumption[] = [], M: MissingItem[] = [];
  const asm = (field: string, value: string, status: Assumption["status"], basis: string) => A.push({ field, value, status, basis });
  const miss = (field: string, why: string, blocking = true) => M.push({ field, why, blocking });
  const { invoice: inv, bol } = s;

  // ---- ports
  const disch = usPort(inv.portOfDischarge ?? bol.portOfDischarge);
  const lading = foreignPort(inv.portOfLoading ?? bol.portOfLoading);
  const entryPort = b.entryPort ?? disch?.code;
  if (b.entryPort) asm("entry-port", b.entryPort, "broker_confirm", "supplied by broker");
  else if (disch) asm("entry-port", disch.code, "assumed", `Assumed entry at port of discharge. ${disch.basis}. The B/L routes goods by truck/ramp to Kent, WA; confirm no in-bond movement.`);
  else miss("entry-port", "Port of discharge not recognised; enter the Schedule D code.");
  let processing = b.processingPort;
  if (!processing) {
    processing = PLACEHOLDER_PORT;
    miss("processing-port", "Depends on the filing broker's processing port. Sentinel 0000 is in the XML and must be replaced.");
  }
  if (disch) asm("unlading-port", disch.code, disch.status, disch.basis);

  // ---- header decisions
  const entryType = b.entryType ?? "01";
  if (!b.entryType) asm("entry-type", "01", "assumed", "Formal consumption entry assumed because entered value is above the informal threshold; broker decides entry type.");
  asm("mode-transportation", "11", "assumed", "11 is accepted by modeTransportType; meaning 'vessel, containerized' recalled from CBP ABI code lists, not re-verified.");
  asm("state-destination", inv.shipTo?.state ?? "", "derived", "State of the ship-to address on the invoice and B/L.");
  asm("carrier-code", bol.masterScac ?? "", "derived", "SCAC of the ocean carrier named on the B/L (Orient Pacific Lines).");
  asm("gross-weight", String(Math.round(bol.grossKg)), "derived", "B/L declared weight used; packing list shows a lower figure (see findings).");
  const charges = (inv.freight ?? 0) + (inv.insurance ?? 0);
  if (charges) asm("charges", String(Math.round(charges)), "assumed", "Freight + insurance as non-dutiable charges (CIF). Semantics of header 'charges' not confirmed in the XSD; verify.");
  asm("entry-date", opts.today, "assumed", "Set to the generation date; the broker sets the real filing/entry date.");
  if (bol.etaDate) asm("arrival-date", bol.etaDate, "assumed", "Estimated arrival date from the invoice; update on arrival.");
  if (!b.importerTaxId) miss("importer-tax-id", "Importer of record EIN/CBP number is not on any document (required unless entry type 86).");
  if (!b.suretyCode) miss("surety-code / bond", "No bond information on the documents.");
  if (!b.locationOfGoods) miss("location-of-goods (FIRMS)", "Needed for cargo release; not on the documents.", false);
  if (!b.ultimateConsigneeTaxId) miss("ultimate-consignee", "Importer (Bluepeak) vs 3PL ship-to (Cascade) is a broker decision; element omitted.", false);
  miss("related-party (Y/N)", "Relationship between seller and buyer not stated.", false);

  // ---- bill of lading split
  const mb = bol.masterBill ? splitBill(bol.masterScac, bol.masterBill) : undefined;
  const hb = splitBill(bol.houseScac, bol.houseBill);
  asm("master-scac/master-bill", `${mb?.scac}/${mb?.number}`, "assumed", "Bill numbers split as SCAC + number (ACE manifest convention, recalled not verified). data_type.xsd billNoType alone would also accept the unsplit string.");
  asm("house-scac/house-bill", `${hb.scac}/${hb.number}`, "assumed", "Same SCAC + number split; B/L shows SCAC BMLV.");

  // ---- invoice
  const inNo = sanitizeInvoiceNo(inv.number);
  if (inNo.changed) asm("invoice-no", inNo.value, "derived", `"${inv.number}" violates invoiceNoType pattern [A-Za-z\\d\\-]{1,17}; slashes replaced with hyphens.`);
  const V = computeValuation(s, b.approvals);
  const exportDate = bol.onBoardDate;
  const countryExport = toIso2(bol.portOfLoading?.split(",").pop()) ?? "VN";
  asm("country-export", countryExport, "assumed", "Goods shipped from Vietnam; the Bangladesh samples were consolidated at Cat Lai, so Vietnam is assumed as country of export for all lines.");
  if (lading) asm("lading-port", lading.code, lading.status, lading.basis);

  const byLine: { style: string; value: number }[] = V.lines.map((x) => ({ style: x.style, value: x.value }));
  for (const lv of V.lines) for (const c of lv.components) {
    if (c.provenance === "suggested") asm(`value ${lv.style}: ${c.id}`, c.amount.toFixed(2), "broker_confirm", `NOT in the entered value. ${c.label}. ${c.basis}`);
    else if (c.provenance === "broker_approved") asm(`value ${lv.style}: ${c.id}`, c.amount.toFixed(2), "broker_approved", `Included. ${c.label}. ${c.basis}`);
    else if (c.id === "foc-customs-value") asm(`value ${lv.style}`, c.amount.toFixed(2), "broker_confirm", `Included as printed. ${c.basis}`);
  }
  const lines = inv.lines.map((l, idx) => {
    const value = V.lines[idx].value;
    const hts = b.htsByStyle?.[l.style] ?? (l.hts ?? "").replace(/\D/g, "");
    if (!b.htsByStyle?.[l.style]) {
      miss(`HTSUS 10-digit for ${l.style}`, `Only "${l.hts}" is on the documents. The XSD accepts 5-10 digits, so a 6-digit value passes validation but is not a fileable classification.`);
    }
    const mfr = l.manufacturer ?? s.factory;
    const mid = buildMid(mfr, l.originCountry);
    asm(`manufacturer-id ${l.style}`, mid.mid ?? "", mid.mid ? "derived" : "assumed", `MID ${mid.note} per 19 CFR Part 102 Appendix. Broker must confirm against the manufacturer's legal name and address.`);
    return `    <line-item>
      ${tag("export-date", exportDate)}
      ${tag("country-origin", l.originCountry)}
      ${tag("manufacturer-id", mid.mid)}
      <tariffs><tariff>
        ${tag("tariff-no", hts)}
        ${tag("value", value.toFixed(2))}
      </tariff></tariffs>
      ${tag("country-export", countryExport)}
      ${tag("lading-port", lading?.code)}
      ${tag("commercial-description", l.description)}
      ${tag("invoice-quantity", l.quantity)}
      ${tag("po-number", inv.po)}
    </line-item>`;
  }).join("\n");

  const entered = V.entered;
  const fx = inv.currency.toUpperCase() !== "USD";
  if (fx) miss("exchange rate", `Invoice currency is ${inv.currency}; foreign-currency element added without a rate so NetCHB can look it up.`, false);

  const containers = bol.containers.map((c) => {
    const size = normalizeContainerSize(c.size); // map "20'GP" etc. to the entry.xsd enumeration; omit if unknown
    return `    <container>
      ${tag("container-number", cleanContainerNumber(c.number))}
      ${tag("container-size", size)}
      ${size ? "<container-type>Dry</container-type>" : ""}
      ${tag("seal-numbers", c.seal)}
    </container>`;
  }).join("\n");
  if (bol.containers.some((c) => normalizeContainerSize(c.size))) asm("container-type", "Dry", "assumed", "Container size mapped to the entry.xsd enumeration; type assumed 'Dry' (general purpose). Confirm with the carrier.");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<entry xmlns="http://www.netchb.com/xml/entry">
  ${b.filerCode ? `<entry-no><user-specified>${tag("filer-code", b.filerCode)}<entry-no>0000000</entry-no></user-specified></entry-no>` : "<entry-no><system-generated/></entry-no>"}
  ${tag("external-reference-number", inv.po)}
  <header>
    ${b.importerTaxId ? tag("importer-tax-id", b.importerTaxId) : cm("importer-tax-id missing: broker input required")}
    ${tag("importer-name", inv.buyer.name)}
    ${b.ultimateConsigneeTaxId ? `<ultimate-consignee>${tag("tax-id", b.ultimateConsigneeTaxId)}</ultimate-consignee>` : ""}
    ${b.processingPort ? "" : cm("processing-port is a 0000 SENTINEL: replace before upload")}
    ${tag("processing-port", processing)}
    ${tag("entry-port", entryPort ?? PLACEHOLDER_PORT)}
    ${tag("entry-date", opts.today)}
    ${tag("entry-type", entryType)}
    ${tag("surety-code", b.suretyCode)}
    ${tag("charges", charges ? Math.round(charges) : undefined)}
    ${tag("gross-weight", Math.round(bol.grossKg))}
    ${tag("total-entry-value", Math.round(entered))}
    ${tag("description", (bol.goodsDescription ?? "WEARING APPAREL").slice(0, 70))}
    ${tag("state-destination", inv.shipTo?.state ?? inv.buyer.state)}
    ${tag("vessel-name", bol.vessel?.slice(0, 20))}
    ${tag("mode-transportation", "11")}
    ${tag("unlading-port", disch?.code)}
    ${tag("arrival-date", bol.etaDate)}
    ${tag("carrier-code", bol.masterScac)}
    ${tag("customer-reference-no", inv.po)}
    ${tag("voyage-no", bol.voyage?.slice(0, 5))}
    ${tag("location-of-goods", b.locationOfGoods)}
  </header>
  <manifest>
    <bill-of-lading>
      ${tag("master-scac", mb?.scac)}${tag("master-bill", mb?.number)}
      ${tag("house-scac", hb.scac)}${tag("house-bill", hb.number)}
      ${tag("quantity", bol.packages)}${tag("unit", bol.packageUnit ?? "CTN")}
    </bill-of-lading>
  </manifest>
  <containers>
${containers}
  </containers>
  <invoices>
    <invoice>
      ${tag("invoice-no", inNo.value)}
      ${fx ? `<foreign-currency>${tag("currency-code", inv.currency.toUpperCase())}</foreign-currency>` : ""}
      <line-items>
${lines}
      </line-items>
    </invoice>
  </invoices>
</entry>
`.replace(/^[ \t]*\n/gm, "");
  return { xml, assumptions: A, missing: M, totals: { entered, byLine }, valuation: V };
}
