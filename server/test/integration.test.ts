import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handleEntryUpload, handleHealth, handleRegenerate, type ApiDeps } from "../src/api.ts";
import { signSource } from "../src/core/sourceProof.ts";
import { buildEntryResponse, type EntryResponseBody } from "../src/contract.ts";
import { toFrontendShipment } from "../src/frontendShape.ts";
import { ExtractionInvalidError, UploadError, MAX_FILE_BYTES } from "../src/core/extract.ts";
import { availableBackends, validateXml, validatorStatus } from "../src/core/validate.ts";
import { processShipment } from "../src/core/pipeline.ts";
// The REAL frontend schema: the contract is checked against production code, not a copy.
import { entryResponseSchema, serviceStatusSchema } from "../../src/features/entry/models.ts";
import type { Shipment } from "../src/core/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const sample = (): Shipment => { const s = JSON.parse(readFileSync(resolve(here, "../../fixtures/sample-shipment.json"), "utf8")); delete s._provenance; return s; };
const TODAY = "2026-10-09";
const KEY = "test-key-not-a-real-secret";
const pdf = (name = "doc.pdf", extra = "") => ({ name, data: Buffer.from("%PDF-1.4\n" + extra) });
const fakeExtract = (s: Shipment = sample()) => async () => s;
const deps = (over: Partial<ApiDeps> = {}): ApiDeps => ({ apiKey: KEY, extract: fakeExtract(), today: () => TODAY, ...over });
const body = (r: { body: unknown }) => r.body as Record<string, any>;

// ---------- contract ----------
test("contract: default response parses with the frontend's production schema", async () => {
  const r = await handleEntryUpload([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")], {}, deps());
  assert.equal(r.status, 200);
  const parsed = entryResponseSchema.safeParse(r.body);
  assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3)));
  assert.equal(parsed.data.shipment.isDemo, false);
  for (const k of ["shipment", "findings", "xml", "validation"]) assert.ok(k in body(r), `missing ${k}`);
  assert.deepEqual(Object.keys(parsed.data.validation).sort(), ["netchb", "syntax", "xsd"]);
  assert.equal(parsed.data.validation.netchb.status, "unavailable");
  assert.equal(parsed.data.validation.netchb.confirmedByBackend, false);
});

test("contract: finding ids are unique, severities valid, and every finding has text", async () => {
  const res = (await buildEntryResponse(sample(), { today: TODAY })) as EntryResponseBody;
  const ids = res.findings.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const f of res.findings) { assert.ok(["attention", "review", "missing"].includes(f.severity)); assert.ok(f.title && f.description); }
});

test("source values flow unchanged: T-shirt 6480, hoodie qty, origins, samples, container uncertainty, missing inputs", async () => {
  const r = body(await handleEntryUpload([pdf()], {}, deps()));
  const l = r["shipment"].lines;
  assert.equal(l[0].amount, 6480); assert.equal(r["source"].invoice.lines[0].statedAmount, 6480);
  assert.match(r["xml"], /<value>6480\.00<\/value>/);
  assert.equal(r["valuation"].entered, 22899);
  const titles: string[] = r["findings"].map((f: any) => f.title);
  for (const t of ["Quantity differs between invoice and packing list", "Mixed countries of origin", "Free-of-charge samples need valuation review", "Container number was corrected by hand on the B/L",
    "Tariff classification remains incomplete", "Missing before filing: importer-tax-id", "Missing before filing: processing-port", "Missing before filing: surety-code / bond"]) assert.ok(titles.includes(t), `missing finding: ${t}`);
  assert.equal(r["readiness"].readyToFile, false);
  assert.ok(!/tariff-no>\d{10}</.test(r["xml"]), "no 10-digit HTSUS may appear unless supplied by a broker");
  assert.doesNotMatch(r["xml"], /<importer-tax-id>/);
});

test("validation mapping: honest about partial schema and about NetCHB", async () => {
  const r = body(await handleEntryUpload([pdf()], {}, deps()));
  assert.equal(r["validation"].syntax.status, "passed");
  assert.equal(r["validation"].xsd.status, "passed");
  const st = await validatorStatus();
  assert.equal(r["validation"].xsd.complete, st.complete);
  assert.match(r["validation"].xsd.message, /never means|does not mean/);
});

// ---------- error handling ----------
test("upload errors: none, not a PDF, empty, oversize, too many, bad broker JSON", async () => {
  assert.deepEqual([(await handleEntryUpload([], {}, deps())).status, body(await handleEntryUpload([], {}, deps()))["code"]], [400, "NO_DOCUMENTS"]);
  const notPdf = await handleEntryUpload([{ name: "x.pdf", data: Buffer.from("hello") }], {}, deps());
  assert.deepEqual([notPdf.status, body(notPdf)["code"]], [415, "BAD_PDF"]);
  assert.equal((await handleEntryUpload([{ name: "x.pdf", data: Buffer.alloc(0) }], {}, deps())).status, 400);
  const big = Buffer.alloc(MAX_FILE_BYTES + 1); big.write("%PDF-");
  const tooBig = await handleEntryUpload([{ name: "big.pdf", data: big }], {}, deps());
  assert.deepEqual([tooBig.status, body(tooBig)["code"]], [413, "TOO_LARGE"]);
  const many = await handleEntryUpload(Array.from({ length: 7 }, () => pdf()), {}, deps());
  assert.deepEqual([many.status, body(many)["code"]], [400, "TOO_MANY_FILES"]);
  const badJson = await handleEntryUpload([pdf()], { broker: "{not json" }, deps());
  assert.equal(badJson.status, 400); assert.match(body(badJson)["error"], /valid JSON/);
  const badShape = await handleEntryUpload([pdf()], { broker: JSON.stringify({ importerTaxId: 5 }) }, deps());
  assert.equal(badShape.status, 400);
});

test("missing API key: clear 503 and the extractor is never called", async () => {
  let called = false;
  const r = await handleEntryUpload([pdf()], {}, deps({ apiKey: undefined, extract: async () => { called = true; return sample(); } }));
  assert.equal(r.status, 503); assert.equal(body(r)["code"], "NO_API_KEY"); assert.match(body(r)["error"], /GEMINI_API_KEY/); assert.equal(called, false);
});

test("model failures map to specific statuses without leaking details or the key", async () => {
  const invalid = await handleEntryUpload([pdf()], {}, deps({ extract: async () => { throw new ExtractionInvalidError("invoice.date: must be an ISO date"); } }));
  assert.equal(invalid.status, 422); assert.equal(body(invalid)["code"], "EXTRACTION_INVALID"); assert.match(body(invalid)["error"], /nothing was guessed/);
  const upstream = await handleEntryUpload([pdf()], {}, deps({ extract: async () => { throw new UploadError("Extraction model error (HTTP 401). Check GEMINI_API_KEY.", 502); } }));
  assert.equal(upstream.status, 502); assert.equal(body(upstream)["code"], "MODEL_ERROR");
  const secret = "Error: boom with " + KEY;
  const origError = console.error; console.error = () => {};
  let crash; try { crash = await handleEntryUpload([pdf()], {}, deps({ extract: async () => { throw new Error(secret); } })); } finally { console.error = origError; }
  assert.equal(crash.status, 500); assert.equal(body(crash)["code"], "INTERNAL"); assert.ok(!JSON.stringify(crash.body).includes(KEY), "secret must never reach the client");
});

test("the API key never appears in any response body", async () => {
  const ok = await handleEntryUpload([pdf()], {}, deps());
  const health = await handleHealth(deps());
  assert.ok(!JSON.stringify(ok.body).includes(KEY)); assert.ok(!JSON.stringify(health.body).includes(KEY));
  assert.equal(body(health)["extraction"].configured, true);
  assert.equal(body(await handleHealth(deps({ apiKey: undefined })))["extraction"].configured, false);
  assert.ok(serviceStatusSchema.safeParse(health.body).success, "health response must satisfy the frontend's schema");
});

// ---------- regenerate / edits ----------
const regen = (mut: (fe: any) => void, broker?: unknown) => {
  const source = sample(); const fe = toFrontendShipment(source); mut(fe);
  return handleRegenerate({ source, sourceProof: signSource(source), shipment: fe, ...(broker ? { broker } : {}) }, deps());
};

test("regenerate without edits reproduces the original response", async () => {
  const source = sample();
  const a = await buildEntryResponse(source, { today: TODAY });
  const r = body(await handleRegenerate({ source, sourceProof: signSource(source), shipment: toFrontendShipment(source) }, deps()));
  assert.equal(r["xml"], a.xml); assert.deepEqual(r["edits"], []);
  assert.ok(entryResponseSchema.safeParse(r).success);
});

test("edit: broker-supplied 10-digit HTSUS enters the XML and clears only that missing item", async () => {
  const r = body(await regen((fe) => { fe.lines[0].hsCode = "6109.10.0012"; }));
  assert.match(r["xml"], /<tariff-no>6109100012<\/tariff-no>/);
  assert.ok(!r["missing"].some((m: any) => m.field === "HTSUS 10-digit for BP-T101"));
  assert.ok(r["missing"].some((m: any) => m.field === "HTSUS 10-digit for BP-H205"));
  assert.deepEqual(r["edits"].map((e: any) => [e.target, e.field]), [["BP-T101", "hsCode"]]);
  assert.ok(r["findings"].some((f: any) => f.title === "Broker edit applied"));
});

test("edit: a 6-digit HS edit is recorded but does not count as classification", async () => {
  const r = body(await regen((fe) => { fe.lines[0].hsCode = "6109.90"; }));
  assert.ok(r["missing"].some((m: any) => m.field === "HTSUS 10-digit for BP-T101"));
  assert.match(r["xml"], /<tariff-no>610990<\/tariff-no>/);
});

test("broker line evidence is explicit, approved, and survives edited regeneration", async () => {
  const source = sample();
  const unapproved = await buildEntryResponse(source, { today: TODAY, broker: { lineEvidence: {
    L5: { manufacturerId: { value: "BDMFR-123", approved: false }, countryOfExport: { value: "BD", approved: false } },
  } } });
  assert.doesNotMatch(unapproved.xml, /<manufacturer-id>BDMFR-123<\/manufacturer-id>/);
  assert.doesNotMatch(unapproved.xml, /<country-export>BD<\/country-export>/);
  assert.ok(unapproved.missing.some((m) => m.field === "manufacturer-id for BP-P118S" && m.blocking));
  assert.ok(unapproved.assumptions.some((a) => a.field === "country-export BP-P118S" && a.status === "broker_confirm"));

  const edited = toFrontendShipment(source); edited.lines[4].description = "BROKER-EDITED SAMPLE DESCRIPTION";
  const approved = await buildEntryResponse(source, { today: TODAY, edited, broker: { lineEvidence: {
    L5: { manufacturerId: { value: "BDMFR-123", approved: true }, countryOfExport: { value: "BD", approved: true } },
  } } });
  assert.match(approved.xml, /<manufacturer-id>BDMFR-123<\/manufacturer-id>/);
  assert.match(approved.xml, /<country-origin>BD<\/country-origin>[\s\S]*?<country-export>BD<\/country-export>/);
  assert.ok(approved.assumptions.some((a) => a.field === "manufacturer-id BP-P118S" && a.status === "broker_supplied"));
  assert.ok(!approved.missing.some((m) => m.field === "manufacturer-id for BP-P118S" || m.field === "country-export for BP-P118S"));
  assert.ok(approved.edits.some((e) => e.field === "description"));
});

test("invalid broker line evidence is rejected rather than approved", async () => {
  const r = await handleEntryUpload([pdf()], { broker: JSON.stringify({ lineEvidence: {
    L5: { manufacturerId: { value: "bad id!", approved: true }, countryOfExport: { value: "ZZ", approved: true } },
  } }) }, deps());
  assert.equal(r.status, 400);
  assert.equal(body(r)["code"], "BAD_REQUEST");
});

test("edit: changing a line amount keeps the printed amount and records a broker override", async () => {
  const r = body(await regen((fe) => { fe.lines[0].amount = 6840; }));
  const comps = r["valuation"].lines[0].components;
  assert.deepEqual(comps.map((c: any) => [c.id, c.amount, c.provenance, c.included]), [["invoice-amount", 6480, "source", false], ["broker-override", 6840, "broker_approved", true]]);
  assert.equal(r["valuation"].lines[0].value, 6840);
  assert.equal(r["source"].invoice.lines[0].statedAmount, 6480);
  assert.match(r["xml"], /<value>6840\.00<\/value>/);
  assert.ok(!r["valuation"].lines[0].components.some((c: any) => c.id === "recomputed-delta"), "no duplicate suggestion once overridden");
});

test("edit: quantity, unit price, description and origin are applied and recorded; bad origin is ignored with a message", async () => {
  const r = body(await regen((fe) => { const l = fe.lines[2]; l.quantity = 910; l.unitPrice = 7; l.description = "CHINO"; l.origin = "China"; fe.lines[3].origin = "Narnia"; }));
  const w = r["source"].invoice.lines[2];
  assert.equal(w.quantity, 900, "source untouched");
  assert.deepEqual(r["edits"].map((e: any) => e.field).sort(), ["description", "origin", "quantity", "unitPrice"]);
  assert.match(r["xml"], /<country-origin>CN<\/country-origin>/);
  assert.ok(r["findings"].some((f: any) => f.title === "Edit not applied" && /Narnia/.test(f.description)));
});

test("edit: summary fields apply, derived origin/destination edits are refused visibly", async () => {
  const r = body(await regen((fe) => { fe.invoiceNumber = "INV 77/A"; fe.packages = 140; fe.origin = "France"; fe.destination = "Mars"; }));
  assert.match(r["xml"], /<invoice-no>INV-77-A<\/invoice-no>/);
  assert.equal(r["shipment"].invoiceNumber, "INV 77/A");
  assert.equal(r["shipment"].packages, 140);
  assert.equal(r["shipment"].origin, "Vietnam / Bangladesh", "origin stays derived from the lines");
  const msgs = r["findings"].filter((f: any) => f.title === "Edit not applied").map((f: any) => f.description).join(" ");
  assert.match(msgs, /France/); assert.match(msgs, /Mars/);
});

test("edit: removing and adding lines are recorded; incomplete added lines are refused", async () => {
  const r = body(await regen((fe) => {
    fe.lines = fe.lines.filter((l: any) => l.id !== "L5");
    fe.lines.push({ id: "new-1", style: "NB-X1", description: "Socks", hsCode: "", quantity: 10, unit: "PCS", unitPrice: 2, amount: null, origin: "Vietnam" });
    fe.lines.push({ id: "new-2", description: "", hsCode: "", quantity: 0, unitPrice: null, amount: null, origin: "" });
  }));
  const styles = r["shipment"].lines.map((l: any) => l.style);
  assert.ok(!styles.includes("BP-P118S")); assert.ok(styles.includes("NB-X1"));
  const added = r["valuation"].lines.find((l: any) => l.style === "NB-X1");
  assert.equal(added.value, 20); assert.equal(added.components[0].provenance, "broker_approved");
  assert.ok(r["findings"].some((f: any) => f.title === "Edit not applied" && /not added/.test(f.description)));
  assert.equal(r["source"].invoice.lines.length, 5, "original extraction keeps all five lines");
});

test("approvals: only the approved components enter the entered value", async () => {
  const r0 = body(await regen(() => {}));
  const r1 = body(await regen(() => {}, { approvals: { acceptRecomputedAmounts: ["L1"] } }));
  const r2 = body(await regen(() => {}, { approvals: { acceptRecomputedAmounts: ["L1"], acceptAssist: ["L4"] } }));
  assert.deepEqual([r0["valuation"].entered, r1["valuation"].entered, r2["valuation"].entered], [22899, 23259, 27439]);
  assert.equal(r2["valuation"].pending, 0);
  assert.match(r2["xml"], /<total-entry-value>27439<\/total-entry-value>/);
});

test("broker inputs: supplied values replace missing items; invalid values fail the XSD check visibly", async () => {
  const good = body(await regen(() => {}, { importerTaxId: "12-3456789", processingPort: "3001", suretyCode: "999" }));
  assert.match(good["xml"], /<importer-tax-id>12-3456789<\/importer-tax-id>/);
  assert.ok(!good["missing"].some((m: any) => m.field === "importer-tax-id"));
  assert.equal(good["validation"].xsd.status, "passed");
  const bad = body(await regen(() => {}, { importerTaxId: "not-an-ein", processingPort: "30" }));
  assert.equal(bad["validation"].xsd.status, "failed");
  assert.match(bad["validation"].xsd.message, /importer-tax-id|processing-port/);
  assert.equal(bad["readiness"].readyToFile, false);
});

test("XML injection: markup in edited text is escaped", async () => {
  const r = body(await regen((fe) => { fe.buyer = "A & B <script>alert(1)</script>"; fe.lines[0].description = "x</commercial-description><evil/>"; }));
  assert.doesNotMatch(r["xml"], /<script>|<evil\/>/);
  assert.match(r["xml"], /A &amp; B &lt;script&gt;/);
  assert.equal(r["validation"].syntax.status, "passed");
});

test("regenerate rejects malformed requests", async () => {
  for (const bad of [undefined, null, {}, { source: sample() }, { source: { nope: 1 }, shipment: {} }, "string"]) {
    const r = await handleRegenerate(bad, deps()); assert.equal(r.status, 400, JSON.stringify(bad)?.slice(0, 40)); assert.equal(body(r)["code"], "BAD_REQUEST");
  }
});

// ---------- validator backends ----------
test("every available XML validator agrees: valid passes; invalid and malformed XML fail", async () => {
  const backends = await availableBackends();
  assert.ok(backends.length > 0, "no XML validator available (install xmllint or the xmllint-wasm dependency)");
  const good = (await processShipment(sample(), {}, TODAY)).xml;
  for (const backend of backends) {
    const v = await validateXml(good, undefined, { backend });
    assert.equal(v.valid, true, `${backend}: ${v.errors.join("; ")}`); assert.equal(v.backend, backend);
    const bad = await validateXml(good.replace("<entry-type>01<", "<entry-type>99<"), undefined, { backend });
    assert.equal(bad.valid, false, `${backend} must reject an invalid entry-type`); assert.equal(bad.syntax.ok, true); assert.match(bad.errors.join(" "), /entry-type/);
    const broken = await validateXml(good.replace("</header>", ""), undefined, { backend });
    assert.equal(broken.valid, false, `${backend} must reject malformed XML`); assert.equal(broken.syntax.ok, false, `${backend} must flag a syntax error`);
  }
});

// ---------- real Express (runs wherever express and multer are installed) ----------
const canImport = async (m: string) => { try { await import(m); return true; } catch { return false; } };
const haveExpress = (await canImport("express")) && (await canImport("multer"));

test("express: multipart upload on `documents`, error statuses, JSON errors, health, regenerate", { skip: haveExpress ? false : "express/multer are not installed in this environment" }, async () => {
  const { createApp } = await import("../src/app.ts");
  const server = createApp(deps()).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const form = (field: string, files: { name: string; data: Buffer }[]) => { const f = new FormData(); files.forEach((x) => f.append(field, new Blob([new Uint8Array(x.data)], { type: "application/pdf" }), x.name)); return f; };
    const ok = await fetch(`${base}/api/entry`, { method: "POST", body: form("documents", [pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")]) });
    assert.equal(ok.status, 200); assert.ok(ok.headers.get("content-type")?.includes("application/json"));
    assert.equal(ok.headers.get("x-content-type-options"), "nosniff"); assert.equal(ok.headers.get("cache-control"), "no-store"); assert.equal(ok.headers.get("x-powered-by"), null);
    const json = await ok.json() as Record<string, unknown>;
    assert.ok(entryResponseSchema.safeParse(json).success); assert.ok(!JSON.stringify(json).includes(KEY));
    const wrongField = await fetch(`${base}/api/entry`, { method: "POST", body: form("files", [pdf()]) });
    assert.equal(wrongField.status, 400); assert.match(((await wrongField.json()) as any).error, /documents/);
    const none = await fetch(`${base}/api/entry`, { method: "POST", body: new FormData() });
    assert.equal(none.status, 400); assert.equal(((await none.json()) as any).code, "NO_DOCUMENTS");
    const text = await fetch(`${base}/api/entry`, { method: "POST", body: form("documents", [{ name: "x.pdf", data: Buffer.from("not a pdf") }]) });
    assert.equal(text.status, 415);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
    const health = await fetch(`${base}/api/health`); assert.equal(health.status, 200);
    const source = sample();
    const rg = await fetch(`${base}/api/entry/regenerate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, sourceProof: signSource(source), shipment: toFrontendShipment(source) }) });
    assert.equal(rg.status, 200);
    const badJson = await fetch(`${base}/api/entry/regenerate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" });
    assert.equal(badJson.status, 400);
  } finally { await new Promise<void>((r) => server.close(() => r())); }
});
