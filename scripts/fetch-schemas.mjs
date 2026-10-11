// Downloads the official NetCHB entry schema files (published through Strix's docs) into schemas/official/ and
// self-verifies them: complete (not truncated), compiles, and the official sample document validates.
// Needs network access. Cross-platform (Node 22+ fetch; validation uses the same validator as the app).
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "schemas", "official");
const BASE = "https://strixsmart.com/api/schema-docs/entry/source";
const FILES = ["entry.xsd", "data_type.xsd", "entry-sample.xml"];
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, ".verified.json"), JSON.stringify({ ok: false, reason: "download in progress" }));

const got = {};
for (const f of FILES) {
  let res;
  try { res = await fetch(`${BASE}/${f}`, { signal: AbortSignal.timeout(60_000) }); }
  catch (e) { fail(`Could not download ${BASE}/${f}: ${e.cause?.code ?? e.message}. Check your network connection or proxy.`); }
  if (!res.ok) fail(`Download failed for ${f}: HTTP ${res.status}`);
  got[f] = await res.text();
}
if (!/<\/xsd:schema>\s*$/.test(got["entry.xsd"]) || !/<\/xsd:schema>\s*$/.test(got["data_type.xsd"])) fail("A schema file looks truncated (no closing </xsd:schema>). Not using it.");
if (!got["entry.xsd"].includes('targetNamespace="http://www.netchb.com/xml/entry"')) fail("entry.xsd does not declare the expected NetCHB entry namespace.");
// Point the data_type import at the local copy instead of a remote URL.
got["entry.xsd"] = got["entry.xsd"].replace(/schemaLocation="[^"]*data_type\.xsd"/g, 'schemaLocation="data_type.xsd"');
for (const f of FILES) writeFileSync(resolve(out, f), got[f]);

const { validateXml, SCHEMA_DIR } = await import("../server/src/core/validate.ts");
const result = await validateXml(got["entry-sample.xml"], SCHEMA_DIR);
const meta = { ok: false, fetchedAt: new Date().toISOString(), source: BASE, validator: result.backend,
  files: Object.fromEntries(FILES.map((f) => [f, { bytes: Buffer.byteLength(got[f]), sha256: createHash("sha256").update(got[f]).digest("hex") }])) };
if (!(result.valid && result.schema === "official")) {
  writeFileSync(resolve(out, ".verified.json"), JSON.stringify({ ...meta, errors: result.errors.slice(0, 20) }, null, 2));
  for (const f of ["entry.xsd", "data_type.xsd"]) rmSync(resolve(out, f), { force: true }); // never leave an unverified schema in use
  fail(`The downloaded schema did not validate its own sample (${result.backend}):\n${result.errors.slice(0, 8).join("\n")}`);
}
writeFileSync(resolve(out, ".verified.json"), JSON.stringify({ ...meta, ok: true }, null, 2));
console.log(`Official schema installed in schemas/official/ and verified with ${result.backend}.`);
console.log("The app will now report the XSD check as using the complete schema. This is a structure check only.");

function fail(message) {
  // Record the failure (so the app never reports a stale "verified" state) and remove any schema files.
  try {
    for (const f of ["entry.xsd", "data_type.xsd"]) rmSync(resolve(out, f), { force: true });
    writeFileSync(resolve(out, ".verified.json"), JSON.stringify({ ok: false, fetchedAt: new Date().toISOString(), source: BASE, reason: message }, null, 2));
  } catch { /* best effort */ }
  console.error(message);
  process.exit(1);
}
