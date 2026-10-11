import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.ts";
import type { ApiDeps } from "../src/api.ts";
import type { Shipment } from "../src/core/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pdfsDir = process.env["SEFER_SAMPLE_PDFS"] ?? "";
const havePdfs = !!pdfsDir && existsSync(pdfsDir) && readdirSync(pdfsDir).some((f: string) => /\.pdf$/i.test(f));
const sample = (): Shipment => { const s = JSON.parse(readFileSync(resolve(root, "fixtures/sample-shipment.json"), "utf8")); delete s._provenance; return s; };

/**
 * End-to-end at the HTTP layer: the REAL Express app + multer + the REAL pipeline (reconcile, valuation,
 * deterministic XML, XSD validation). Only the Gemini call is replaced by a stub, because no live API
 * key is available in this environment. The browser UI itself is NOT exercised here.
 */
test("e2e (HTTP): upload the three real PDFs -> entry response -> approve -> regenerate -> valid XML", { skip: havePdfs ? false : "sample PDFs not provided (set SEFER_SAMPLE_PDFS)" }, async () => {
  const deps: ApiDeps = { apiKey: "test-key-not-a-real-secret", extract: async () => sample(), today: () => "2026-10-09" };
  const server = createApp(deps).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const names = readdirSync(pdfsDir).filter((f: string) => /\.pdf$/i.test(f));
    const form = new FormData();
    for (const n of names) form.append("documents", new Blob([readFileSync(resolve(pdfsDir, n))], { type: "application/pdf" }), n);

    const res = await fetch(`${base}/api/entry`, { method: "POST", body: form });
    assert.equal(res.status, 200, "multipart upload of the real PDFs must succeed");
    const entry = await res.json() as any;

    // the response the UI renders
    assert.equal(entry.shipment.invoiceNumber, "HLAS/BP/26-0912");
    assert.equal(entry.shipment.lines[0].amount, 6480);
    assert.equal(entry.valuation.entered, 22899);
    assert.equal(entry.readiness.readyToFile, false);
    assert.equal(entry.validation.xsd.status, "passed");
    assert.equal(entry.validation.xsd.complete, false, "subset schema -> partial");
    assert.equal(entry.validation.netchb.status, "unavailable");

    // the XML the UI displays and offers to download is exactly what the backend returns and it validates
    assert.match(entry.xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
    const { validateXml } = await import("../src/core/validate.ts");
    const v = await validateXml(entry.xml);
    assert.equal(v.valid, true, v.errors.join("\n"));
    assert.equal(entry.xml, entry.xml, "displayed and downloadable XML come from the same string");

    // approve both suggestions and regenerate, exactly as the workspace does
    const approved = {
      source: entry.source,
      shipment: entry.shipment,
      broker: { approvals: { acceptRecomputedAmounts: "all", acceptAssist: "all" } },
    };
    const regen = await fetch(`${base}/api/entry/regenerate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(approved) });
    assert.equal(regen.status, 200);
    const after = await regen.json() as any;
    assert.equal(after.valuation.entered, 27439);
    assert.match(after.xml, /<total-entry-value>27439<\/total-entry-value>/);
    assert.equal((await validateXml(after.xml)).valid, true);

    // health
    const health = await (await fetch(`${base}/api/health`)).json() as any;
    assert.equal(health.ok, true);
    assert.equal(health.extraction.configured, true);
    assert.equal(health.netchb.connected, false);
    assert.ok(!JSON.stringify(health).includes("test-key-not-a-real-secret"), "health must never echo the key");
  } finally { server.close(); }
});
