import type { Assumption, BrokerInputs, BuildResult, MissingItem, Shipment } from "./types.ts";
import { cleanContainerNumber, foreignPort, normalizeContainerSize, sanitizeInvoiceNo, splitBill, toIso2, usPort } from "./normalize.ts";
import { computeValuation } from "./valuation.ts";

// XML 1.0 forbids most C0 control characters. Strip them before escaping so they can never produce malformed XML;
// the reconcile step separately reports any document field that contained them.
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const esc = (v: string | number) => String(v).replace(XML_INVALID, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tag = (n: string, v: string | number | undefined) => (v === undefined || v === "" ? "" : `<${n}>${esc(v)}</${n}>`);
const cm = (t: string) => `<!-- ${t.replace(/--/g, "-")} -->`;
const PLACEHOLDER_PORT = "0000";

/** Builds the uploadEntry XML following NetCHB entry.xsd element order. Deterministic: no LLM involved. */
export function buildEntry(s: Shipment, b: BrokerInputs = {}, opts: { today: string }): BuildResult {
  const A: Assumption[] = [], M: MissingItem[] = [];
  const asm = (field: string, value: string, status: Assumption["status"], basis: string) => A.push({ field, value, status, basis });
  const miss = (field: string, why: string, blocking = true) => M.push({ field, why, blocking });
  const { invoice: inv, bol } = s;
  // Fit a value to a schema field length. Over-length material data is FLAGGED (never silently truncated) and the
  // finding tells the broker to shorten it or confirm a supported transformation.
  const fit = (label: string, v: string | undefined, max: number): string | undefined => {
    if (v === undefined) return undefined;
    if (v.length <= max) return v;
    miss(label, `The ${label} is ${v.length} characters but the schema field allows ${max}. It was cut to ${max} characters in the XML, so the XML does not carry the documented value. Shorten the source value or confirm a supported transformation before filing.`);
    return v.slice(0, max);
  };
  if (bol.goodsDescription === undefined) miss("goods description", "No goods description was found on the documents; the header description is omitted rather than defaulted.", false);

  // ---- ports
  const disch = usPort(inv.portOfDischarge ?? bol.portOfDischarge);
  const lading = foreignPort(inv.portOfLoading ?? bol.portOfLoading);
  const entryPort = b.entryPort ?? disch?.code;
  if (b.entryPort) asm("entry-port", b.entryPort, "broker_confirm", "supplied by broker");
  else if (disch) asm("entry-port", disch.code, "assumed", `Assumed entry at the port of discharge. ${disch.basis}. Confirm the goods did not move in-bond before entry.`);
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
  // Do not put empty placeholders in the assumptions response. Those records are
  // rendered directly by the client; an absent source value is missing data, not
  // a derived value with an empty string.
  if (inv.shipTo?.state) asm("state-destination", inv.shipTo.state, "derived", "State of the ship-to address on the invoice and B/L.");
  else miss("state-destination", "The ship-to state is not stated on the documents; it is omitted rather than inferred.", false);
  if (bol.masterScac) asm("carrier-code", bol.masterScac, "derived", "SCAC of the ocean carrier named on the B/L.");
  else miss("carrier-code", "No master-carrier SCAC was found on the B/L; it is omitted rather than inferred.", false);
  asm("gross-weight", String(Math.round(bol.grossKg)), "derived", "Gross weight declared on the B/L (see findings for any cross-document difference).");
  const charges = (inv.freight ?? 0) + (inv.insurance ?? 0);
  if (charges) asm("charges", String(Math.round(charges)), "assumed", "Freight + insurance as non-dutiable charges (CIF). Semantics of header 'charges' not confirmed in the XSD; verify.");
  asm("entry-date", opts.today, "assumed", "Set to the generation date; the broker sets the real filing/entry date.");
  if (bol.etaDate) asm("arrival-date", bol.etaDate, "assumed", "Estimated arrival date from the B/L; update on arrival.");
  if (!b.importerTaxId) miss("importer-tax-id", "Importer of record EIN/CBP number is not on any document (required unless entry type 86).");
  if (!b.suretyCode) miss("surety-code / bond", "No bond information on the documents.");
  if (!b.locationOfGoods) miss("location-of-goods (FIRMS)", "Needed for cargo release; not on the documents.");
  if (!b.ultimateConsigneeTaxId) miss("ultimate-consignee", "The importer vs the 3PL ship-to consignee is a broker decision; the element is omitted.", false);
  miss("related-party (Y/N)", "Relationship between seller and buyer not stated.", false);

  // ---- bill of lading split
  const mb = bol.masterBill ? splitBill(bol.masterScac, bol.masterBill) : undefined;
  const hb = splitBill(bol.houseScac, bol.houseBill);
  if (mb) {
    if (mb.split) asm("master-scac/master-bill", `${mb.scac}/${mb.number}`, "assumed", "Bill number split as SCAC + number (ACE manifest convention, recalled not verified). data_type.xsd billNoType alone would also accept the unsplit string. Confirm the SCAC against the manifest.");
    else { asm("master-bill", mb.number, "broker_confirm", `The printed master bill "${bol.masterBill}" does not start with the carrier SCAC "${bol.masterScac ?? "?"}", so it is emitted UNSPLIT and the SCAC is omitted until a broker confirms the split.`); miss("master-scac split", "The master bill number could not be split into SCAC + number; confirm it against the manifest.", false); }
  }
  if (hb.split) asm("house-scac/house-bill", `${hb.scac}/${hb.number}`, "assumed", "Bill number split as SCAC + number; confirm the SCAC against the manifest.");
  else { asm("house-bill", hb.number, "broker_confirm", `The printed house bill "${bol.houseBill}" does not start with the carrier SCAC "${bol.houseScac ?? "?"}", so it is emitted UNSPLIT and the SCAC is omitted until a broker confirms the split.`); miss("house-scac split", "The house bill number could not be split into SCAC + number; confirm it against the manifest.", false); }

  // ---- invoice
  const inNo = sanitizeInvoiceNo(inv.number);
  if (inNo.changed) asm("invoice-no", inNo.value, "derived", `"${inv.number}" violates invoiceNoType pattern [A-Za-z\\d\\-]{1,17}; slashes replaced with hyphens.`);
  if (inNo.truncated) { asm("invoice-no truncated", inNo.value, "broker_confirm", `"${inv.number}" exceeds 17 characters and was truncated for the schema; confirm the full value and check it does not collide with another entry.`); miss("invoice number", "The invoice number was truncated to 17 characters; confirm the full value with the shipper.", false); }
  const V = computeValuation(s, b.approvals);
  const exportDate = bol.onBoardDate;
  // A loading port is useful shipment context, but it does not establish a country of export. Country of export is
  // emitted only from an explicit source line value or valid, approved broker line evidence; it is never copied from
  // country of origin or inferred from a port.
  if (lading) asm("lading-port", lading.code, lading.status, lading.basis);

  const byLine: { style: string; value: number }[] = V.lines.map((x) => ({ style: x.style, value: x.value }));
  for (const lv of V.lines) for (const c of lv.components) {
    if (c.provenance === "suggested") asm(`value ${lv.id}: ${c.id}`, c.amount.toFixed(2), "broker_confirm", `NOT in the entered value. ${c.label}. ${c.basis}`);
    else if (c.provenance === "broker_approved") asm(`value ${lv.id}: ${c.id}`, c.amount.toFixed(2), "broker_approved", `Included. ${c.label}. ${c.basis}`);
    else if (c.id === "foc-customs-value") asm(`value ${lv.style}`, c.amount.toFixed(2), "broker_confirm", `Included as printed. ${c.basis}`);
  }
  const lines = inv.lines.map((l, idx) => {
    const value = V.lines[idx].value;
    const brokerHts = b.htsByStyle?.[l.id ?? ""];
    // Validate here too: buildEntry is also used directly by tests and integrations, which need the same guard as
    // the request schema. A malformed broker value must never turn an unresolved classification into XML content.
    const approvedBrokerHts = brokerHts && /^\d{10}$/.test(brokerHts) ? brokerHts : undefined;
    // Retain the source-stated HS fragment in draft XML for traceability and schema structure, but it is never
    // treated as a fileable classification: readiness remains blocked until an explicitly broker-supplied 10-digit
    // value replaces it. A malformed broker replacement cannot enter this field or clear that blocker.
    const hts = approvedBrokerHts ?? (l.hts ?? "").replace(/\D/g, "");
    if (approvedBrokerHts) {
      asm(`HTSUS 10-digit for ${l.style}`, approvedBrokerHts, "broker_supplied", "Supplied as a 10-digit broker classification. Classification approval remains a broker responsibility.");
    } else {
      if (brokerHts) asm(`HTSUS 10-digit for ${l.style}`, brokerHts, "broker_confirm", "Broker-supplied HTSUS is not exactly 10 digits; it is omitted as an approved classification.");
      miss(`HTSUS 10-digit for ${l.style}`, `Only "${l.hts}" is on the documents. The XSD accepts 5-10 digits, so a 6-digit value passes validation but is not a fileable classification.`);
    }
    if (l.originCountry === undefined) miss(`country-of-origin for ${l.style}`, "No document states the country of origin for this line; it is required and is never inferred.", true);
    const evidence = b.lineEvidence?.[l.id ?? ""];
    const suppliedManufacturerId = evidence?.manufacturerId;
    // IDs must fit the bundled schema's 15-character manufacturer field. A malformed source value remains visible
    // in the audit trail, but is not emitted as a schema-looking manufacturer ID.
    const sourceManufacturerId = l.manufacturerId?.trim();
    const validSourceManufacturerId = sourceManufacturerId && /^[A-Za-z0-9-]{1,15}$/.test(sourceManufacturerId)
      ? sourceManufacturerId
      : undefined;
    // Broker MIDs have the same intentionally narrow, conservative format. Direct callers get the same protection
    // as the request schema and cannot turn a malformed value into XML content.
    const approvedBrokerManufacturerId = suppliedManufacturerId?.approved && /^[A-Za-z0-9-]{1,15}$/.test(suppliedManufacturerId.value)
      ? suppliedManufacturerId.value
      : undefined;
    const manufacturerId = validSourceManufacturerId ?? approvedBrokerManufacturerId;
    if (validSourceManufacturerId) asm(`manufacturer-id ${l.style}`, validSourceManufacturerId, "verified", "Identifier explicitly extracted from the source documents.");
    else if (approvedBrokerManufacturerId) asm(`manufacturer-id ${l.style}`, approvedBrokerManufacturerId, "broker_supplied", sourceManufacturerId ? "Supplied and explicitly approved by the broker after the extracted value failed the supported format; the source value remains available for review." : "Supplied and explicitly approved by the broker; not present in the extracted documents.");
    else if (sourceManufacturerId) asm(`manufacturer-id ${l.style}`, sourceManufacturerId, "broker_confirm", "Value was extracted from the source documents but does not fit the supported manufacturer-ID format (1-15 letters, numbers, or hyphens); omitted from XML pending broker confirmation.");
    else {
      if (suppliedManufacturerId) asm(`manufacturer-id ${l.style}`, suppliedManufacturerId.value, "broker_confirm", suppliedManufacturerId.approved ? "Broker-supplied manufacturer ID fails the supported format (1-15 letters, numbers, or hyphens); omitted from XML." : "Supplied by the broker but not approved; omitted from XML until approval.");
      miss(`manufacturer-id for ${l.style}`, "No approved manufacturer ID is available. It is omitted rather than constructed from company or location details.");
    }
    const suppliedCountryExport = evidence?.countryOfExport;
    const sourceCountryExport = toIso2(l.exportCountry);
    const approvedBrokerCountryExport = suppliedCountryExport?.approved ? toIso2(suppliedCountryExport.value) : undefined;
    const countryExport = sourceCountryExport ?? approvedBrokerCountryExport;
    if (sourceCountryExport) asm(`country-export ${l.style}`, sourceCountryExport, "verified", "Country of export explicitly extracted for this line.");
    else if (approvedBrokerCountryExport) asm(`country-export ${l.style}`, approvedBrokerCountryExport, "broker_supplied", l.exportCountry ? "Supplied and explicitly approved by the broker after the extracted value was not a recognised ISO country; the source value remains available for review." : "Supplied and explicitly approved by the broker; not present in the extracted documents.");
    else if (l.exportCountry) asm(`country-export ${l.style}`, l.exportCountry, "broker_confirm", "Value was extracted from the source documents but is not a recognised ISO country; omitted from XML pending broker confirmation.");
    else {
      if (suppliedCountryExport) asm(`country-export ${l.style}`, suppliedCountryExport.value, "broker_confirm", suppliedCountryExport.approved ? "Broker-supplied country of export is not a recognised ISO country; omitted from XML." : "Supplied by the broker but not approved; omitted from XML until approval.");
      miss(`country-export for ${l.style}`, "No approved line-specific country-of-export evidence is available.");
    }
    return `    <line-item>
      ${tag("export-date", exportDate)}
      ${tag("country-origin", l.originCountry)}
      ${tag("manufacturer-id", manufacturerId)}
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

  if (b.filerCode) { asm("entry-no", `${b.filerCode} / 0000000`, "broker_confirm", "The entry number is assigned by NetCHB at upload. The 0000000 here is a schema placeholder, NOT a real entry number, and must not be treated as one."); miss("entry number", "Assigned by NetCHB at upload; the 0000000 placeholder is not a real entry number.", false); }
  const entered = V.entered;
  const fx = inv.currency.toUpperCase() !== "USD";
  if (fx) miss("exchange rate", `Invoice currency is ${inv.currency.toUpperCase()}, not USD. No verified exchange rate is available, so line values and total-entry-value in this XML are the UNCONVERTED ${inv.currency.toUpperCase()} amounts and must not be treated as USD. A broker must supply a verified conversion before filing.`);

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
  <!-- DRAFT ENTRY SUMMARY ONLY - NOT FOR OFFICIAL CBP/NETCHB SUBMISSION WITHOUT LICENSED BROKER REVIEW AND COMPLETED FIELDS -->
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
    ${tag("description", fit("goods description", bol.goodsDescription, 70))}
    ${tag("state-destination", inv.shipTo?.state)}
    ${tag("vessel-name", fit("vessel name", bol.vessel, 20))}
    ${tag("mode-transportation", "11")}
    ${tag("unlading-port", disch?.code)}
    ${tag("arrival-date", bol.etaDate)}
    ${tag("carrier-code", bol.masterScac)}
    ${tag("customer-reference-no", inv.po)}
    ${tag("voyage-no", fit("voyage number", bol.voyage, 5))}
    ${tag("location-of-goods", b.locationOfGoods)}
  </header>
  <manifest>
    <bill-of-lading>
      ${mb?.split ? tag("master-scac", mb.scac) : ""}${tag("master-bill", mb?.number)}
      ${hb.split ? tag("house-scac", hb.scac) : ""}${tag("house-bill", hb.number)}
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
