// Regenerates src/test/fixtures/backend-response.json from the REAL backend code (no hand-written response).
// Uses the hand-transcribed sample shipment in fixtures/ and a fixed date so the output is deterministic.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { buildEntryResponse } = await import("../server/src/contract.ts");
const source = JSON.parse(readFileSync(resolve(root, "fixtures/sample-shipment.json"), "utf8"));
delete source._provenance;
const res = await buildEntryResponse(source, { today: "2026-10-09" });
writeFileSync(resolve(root, "src/test/fixtures/backend-response.json"), JSON.stringify(res, null, 2) + "\n");
console.log(`fixture written: ${res.findings.length} findings, entered value ${res.valuation.entered}, xsd=${res.validation.xsd.status} complete=${res.validation.xsd.complete}`);
