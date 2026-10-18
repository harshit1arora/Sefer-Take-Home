# Research log

Labels: **verified** = read in a primary source while building this; **assumed** = my inference, not confirmed; **derived** = computed by a stated rule from document values; **broker** = a licensed broker must decide. Nothing here is legal or customs advice.

## NetCHB web service and schema

| Finding | Label | Source |
|---|---|---|
| NetCHB publishes SOAP services under `/main/services/`; entry upload is `EntryUploadService` (`uploadEntry`, `amendEntry`, `queryEntryStatus`, `updateBol`, `deleteEntry`); the request carries credentials plus the entry XML as a string | verified | https://www.netchb.com/main/services/JamcoXmlUploadService and the EntryUploadService page it links |
| Upload response format (accepted / rejected, warnings) | verified | https://www.netchb.com/xml/entry/entryUploadResponse.html |
| `entry.xsd` (namespace `http://www.netchb.com/xml/entry`): root `entry` is an ordered sequence `entry-no, ..., header, manifest, containers, invoices`; header, invoice, line-item and tariff use `xsd:all` | verified | https://strixsmart.com/api/schema-docs/entry/source/entry.xsd (a Strix-hosted mirror whose own text says NetChb) |
| `data_type.xsd` patterns: `invoiceNoType [A-Za-z\d\-]{1,17}` (so `HLAS/BP/26-0912` is invalid), `tariffNoType \d{5,10}` (a 6-digit HS passes the XSD but is not fileable), `portType \d{4}`, `foreignPortType \d{5}`, `dollarAmountType` 2 decimals, `billNoType [\dA-Za-z]{0,50}`, `manufacturerIdType` max 15 | verified | https://strixsmart.com/api/schema-docs/entry/source/data_type.xsd |
| `entry-sample.xml` shows which fields cargo release needs (state-destination, vessel/voyage, unlading-port, lading-port, country-export, export-date, location-of-goods) | verified | https://strixsmart.com/api/schema-docs/entry/source/entry-sample.xml |
| Whether the Strix mirror is byte-identical to NetCHB's own copy | **unknown** | not checked |
| `entry.xsd` as fetched by my tool was cut off before the PGA, entity (`entityType`) and bond types | verified (limitation) | the bundled `schemas/entry.xsd` is therefore a **subset**; `npm run fetch-schemas` downloads the complete files with a normal HTTP client |

### What the XSD check covers

| Mode | Schema used | Covers | Does not cover |
|---|---|---|---|
| Default / offline | bundled subset (`schemas/entry.xsd`, `data_type.xsd`) | the elements this app emits: header, manifest, containers, invoices, line items, tariffs | PGA sections, ACE parties, bond type, everything not emitted |
| After `npm run fetch-schemas` succeeds | `schemas/official/` (self-verified: complete, compiles, official sample validates) | the full official structure | any customs correctness, any NetCHB business rule, acceptance |

The backend reports which one ran (`validation.xsd.schema`, `complete`) and the UI labels a subset pass as "Passed · partial schema only".

## Codes and rules

| Item | Result | Label | Source |
|---|---|---|---|
| Tacoma, WA Schedule D | 3002 (Seattle 3001) | verified | CBP CSMS 15-000496 https://content.govdelivery.com/accounts/USDHSCBP/bulletins/1120949 ; FDA port list https://www.fda.gov/industry/import-offices-and-ports-entry/washington-state-import-offices-and-ports-entry |
| Cat Lai Schedule K | CBP ACE Appendix F lists 55224 (Ho Chi Minh City) and 55225 (Tan Cang); Cat Lai is not named. The app uses 55224 | assumed / broker | https://cbp.gov/sites/default/files/2024-08/ACE%20Appendix%20F%20Schedule%20K_21_8_2024_v1_508_0.pdf |
| Manufacturer ID | The MID construction rule is documented, but the supplied documents do not state a manufacturer ID. The application does **not** construct an identifier from company or location data; it remains missing until a broker supplies and explicitly approves a line-specific value. | rule reference only; resulting identifier **broker supplied / unverified** | 19 CFR Part 102 Appendix (https://www.law.cornell.edu/cfr/text/19/appendix-to_part_102) |
| Buyer-supplied fabric (USD 4,180) | Free materials incorporated in the goods are assists, 19 U.S.C. 1401a(h)(1)(A). Kept **separate** from the invoice amount and **excluded** from the entered value until approved | principle verified from search summaries and ruling mirrors (e.g. HRL 563369); amount **broker** | https://open-gov.usebase.io/rulings/563369 (mirror, not read in full). Primary CBP pages (Value Encyclopedia) surfaced in search but were not read in full |
| Free-of-charge polo samples | Entered at the printed USD 1.00/pc customs value (USD 24.00, a source component). HTSUS 9811.00.60 may apply to samples valued at $1 or less (this shipment is exactly $1.00/pc), subject to marking rules | partly verified from ruling summaries; **broker** | https://www.tarifflens.ai/hts/9811.00.6000 , https://www.tarifflens.ai/rulings/560135 (secondary sites) |
| Mixed origin and export country | The sample line retains country-origin `BD`. A Vietnam loading port does not establish that line's country of export, so `country-export` is omitted until a source-stated or broker-supplied, explicitly approved line value is available. Origin and export country are separate fields. | **broker / unresolved** | packing list remark 3; invoice declaration |
| Broker line evidence | Broker input uses `lineEvidence[lineId]`, with `manufacturerId` and/or `countryOfExport` objects containing `{ value, approved }`. Only `approved: true` is emitted; the response records it as `broker_supplied`. An unapproved value remains omitted and blocking. | application behavior; not an official filing rule | `server/src/core/schemas.ts`, `server/src/core/entryXml.ts` |
| Entry type `01`, mode of transport `11` | both accepted by the XSD enumerations; meanings recalled from CBP ABI lists | assumed | not re-verified against CATAIR |
| SCAC + number split of bill numbers (`OPLU`+`SGN26090001`, `BMLV`+`HCM26090001`) | follows the ACE manifest convention; unsplit strings would also pass the XSD | assumed | not verified |
| Header `charges` = freight + insurance (4,035) | semantics not confirmed in the XSD text I read | assumed | - |

## Valuation rules used (what is and is not documented)

| Component | Provenance | Rule / basis | Label |
|---|---|---|---|
| Printed invoice line amounts (6,480.00; 8,880.00; 6,255.00; 1,260.00) | source | Copied unchanged; checked against the invoice PDF text layer (`docs/source-trace.md`) | verified |
| FOC sample customs value 24.00 | source | Printed on the invoice as "value for customs purpose only"; samples have no commercial value | verified as printed; treatment = broker |
| T-shirt correction +360.00 (2,400 x 2.85 = 6,840.00 vs printed 6,480.00) | **suggested** | For: the invoice's carried-forward subtotal (21,975), FOB total (23,235) and CIF total (27,270) only add up with 6,840. Against / alternative: 2,400 x 2.70 = 6,480.00 (a unit-price misprint), but then the invoice totals would be wrong. The documents do not settle which figure was paid | **broker / importer to confirm** (for example the payment record) |
| Assist +4,180.00 on W-B220 | **suggested** | Amount from the invoice note; principle from 19 U.S.C. 1401a(h)(1)(A); cost of acquisition and added costs unconfirmed | **broker** |
| Freight 3,850.00 and insurance 185.00 excluded | derived | CIF sale; invoice lines are FOB-priced (the invoice labels the line total "TOTAL FOB VALUE"). Statutory basis recalled (19 U.S.C. 1401a(b)(4)(A)), not re-read | assumed |
| Duty | not calculated | needs 10-digit HTSUS and program/tariff status | out of scope |

Result: **entered value 22,899.00** from source amounts only; **27,439.00** if both suggestions are approved. A broker may also override a line amount in the UI; that is recorded as a separate `broker_approved` component and the printed amount stays visible.

## Source discrepancies reported (never silently resolved)

| Finding | Evidence | App behaviour |
|---|---|---|
| T-shirt line amount 6,480.00 vs 2,400 x 2.85 = 6,840.00 | invoice text layer; invoice totals agree with 6,840 | printed amount kept; +360.00 suggested, excluded until approved |
| Hoodie quantity: invoice 1,200 vs packing list 1,176 (49 cartons x 24) | the 24-piece gap equals the sample quantity (a hypothesis, flagged as such) | both reported; invoice value kept |
| Gross weight: B/L 1,930 kg vs packing list 1,888 kg | scans | B/L figure used in the XML and the summary (assumption listed); both numbers in the finding |
| Container number: printed OPLU1041726 struck out, handwritten OPLU1041723 | ISO 6346 check digit: printed invalid, handwritten valid | corrected number used; finding "corrected by hand" asks for carrier confirmation |
| Mixed origin: 24 Bangladesh-origin samples on a Vietnam-origin invoice | packing list remark 3 | separate `BD` origin line; manufacturer ID and country of export remain blocking missing values until approved evidence is supplied |
| Invoice number `HLAS/BP/26-0912` is invalid for NetCHB | `invoiceNoType` pattern | submitted as `HLAS-BP-26-0912`, flagged, original kept in the UI |

## Run log for the integration (build sandbox, 2026-10-10)

| Step | Command | Result |
|---|---|---|
| Install dependencies | `npm run install:all` | **NOT RUN / BLOCKED**: no network; `https://registry.npmjs.org` unreachable (earlier attempt timed out, exit 124) |
| Fetch official schemas | `npm run fetch-schemas` | **NOT RUN / BLOCKED**: earlier attempt: `curl: (6) Could not resolve host: strixsmart.com`; the Node script was only syntax-checked |
| Gemini extraction (live, 2026-10-11) | real `generateContent` with the three sample PDFs | **HTTP 200**; Zod-validated; entered value 22,899 (27,439 with approvals); XML passed the subset schema. A first run was truncated (thinking billed against `maxOutputTokens`) and a container size (`20'GP`) failed the schema — both fixed; see `docs/FINAL-VERIFICATION.md` |
| Start Express / Vite | `npm run dev` | **NOT RUN**: express, multer, vite not installed |
| Backend tests | `node --test` (3 files) | 49 tests: 48 pass, 1 skipped (real-Express test, needs express/multer), 0 fail |
| Frontend tests | local vitest-compatible **shim** on `src/test/entry.test.ts` | 25 of 25 pass. Not real vitest, not jsdom. `app-routing.test.tsx` not run |
| Type check, server | `tsc` with real `@types/node` and stubbed express/multer/xmllint-wasm types | 0 errors |
| Type check, frontend | `tsc` on touched files with stubbed react/ui/router types | 0 errors other than TS7006 implicit-any on event handlers (artifacts of the stubs) |
| Real `npm run typecheck`, `npm run build`, `npm run lint` | | **NOT RUN** |
| Source trace | `npm run trace -- <pdf folder>` | invoice: 5/5 lines and 5/5 totals match the PDF text layer. Packing list: OCR corroborates the printed identifiers. B/L: OCR did **not** find the master bill number or the seal number, so those stay unverified visual transcription |
| XSD validation | native `xmllint` against `schemas/entry.xsd` | generated XML valid against the **bundled subset** only; `xmllint-wasm` path not exercised |
| Defects found by running things | | `detectDocumentType` mislabelled `..._House_BL.pdf` as "Unclassified PDF" (a bug present in the supplied frontend); fixed and covered by a test |

## URLs from the original brief that were not used
Census Schedule D/K pages, hts.usitc.gov and rulings.cbp.gov (CROSS) were not fetched directly. Port codes came from the CBP and FDA pages above. No HTS classification was attempted.

## Extraction model (added in the final pass)

| Finding | Label | Source |
|---|---|---|
| Gemini 3.8 Flash (`gemini-3.8-flash`) is listed as a stable multimodal model with PDF input | verified via current Google documentation | https://ai.google.dev/gemini-api/docs/models and https://ai.google.dev/gemini-api/docs/pricing |
| The extraction model is configurable via `GEMINI_MODEL`; the default is `gemini-3.8-flash`; a non-`gemini-*` value is ignored with a warning | verified (by the code and its tests) | `server/src/core/extract.ts`, `server/test/config.test.ts` |
| Whether a given model id is actually available on a specific account/region | **broker/user to confirm** | the provider returns a clear error if the id is unavailable; the app surfaces it |


## Gemini extraction provider (current implementation)

The backend uses Google's Gemini `generateContent` REST endpoint. Each PDF is sent as base64 `inline_data` with `mime_type: application/pdf`; the request asks for JSON output, then the response is parsed and validated against the existing shipment schema. Current documented model reference: https://ai.google.dev/gemini-api/docs/models. Free-tier limits, data handling, and model availability depend on Google's current terms and the user's account; verify them before uploading sensitive commercial documents.

Live extraction **was** performed on 2026-10-11 with a user-supplied key against the three sample PDFs (HTTP 200, values matched the source documents; see `docs/FINAL-VERIFICATION.md`). Model availability, free-tier limits and data handling still depend on Google's terms and the account.
