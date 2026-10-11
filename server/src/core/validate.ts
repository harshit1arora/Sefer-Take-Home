import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ValidationResult } from "./types.ts";

const run = promisify(execFile);

export const SCHEMA_DIR = process.env["SEFER_SCHEMA_DIR"] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../schemas");

const SUBSET_NOTE =
  "Checked against the BUNDLED SUBSET schema only (PGA, entity and bond types are not defined in it). Run `npm run fetch-schemas` to validate against the full official schema. A pass never means the customs data is correct or that NetCHB will accept the entry.";
const OFFICIAL_NOTE =
  "Checked against the official schema files in schemas/official/ (downloaded and self-verified by `npm run fetch-schemas`). This is structure only: a pass does not mean the customs data is correct or that NetCHB will accept the entry.";
const UNVERIFIED_NOTE =
  "Checked against files in schemas/official/, but they were not self-verified by `npm run fetch-schemas`, so completeness is not confirmed. Re-run the script. A pass never means the customs data is correct or that NetCHB will accept the entry.";

export interface SchemaInfo { schema: "official" | "subset"; path: string; complete: boolean; note: string }

export function pickSchema(dir = SCHEMA_DIR): SchemaInfo {
  const official = join(dir, "official", "entry.xsd");
  if (existsSync(official)) {
    let verified = false;
    try { verified = JSON.parse(readFileSync(join(dir, "official", ".verified.json"), "utf8")).ok === true; } catch { /* not verified */ }
    return { schema: "official", path: official, complete: verified, note: verified ? OFFICIAL_NOTE : UNVERIFIED_NOTE };
  }
  return { schema: "subset", path: join(dir, "entry.xsd"), complete: false, note: SUBSET_NOTE };
}

let nativeCache: boolean | undefined;
async function hasNativeXmllint(): Promise<boolean> {
  if (nativeCache !== undefined) return nativeCache;
  try { await run("xmllint", ["--version"]); nativeCache = true; }
  catch (e) { nativeCache = (e as { code?: unknown }).code !== "ENOENT"; } // missing binary only; any other error means it exists
  return nativeCache;
}

const SYNTAX_RE = /parser error|Premature end|not well-formed|Opening and ending tag mismatch|StartTag|EndTag|Extra content|Document is empty|xmlParse/i;

async function viaNative(xml: string, schemaPath: string): Promise<string[] | "ok"> {
  const dir = await mkdtemp(join(tmpdir(), "entry-"));
  const file = join(dir, "entry.xml");
  try {
    await writeFile(file, xml, "utf8");
    try { await run("xmllint", ["--noout", "--schema", schemaPath, file]); return "ok"; }
    catch (e) {
      const err = e as { stderr?: string; message: string };
      return String(err.stderr ?? err.message).split(/\r?\n/).filter((l) => l && !/fails to validate$/.test(l)).map((l) => l.split(file).join("entry.xml").replace(/^\s*entry\.xml:/, "line "));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function viaWasm(xml: string, schemaPath: string): Promise<string[] | "ok"> {
  const mod = (await import("xmllint-wasm")) as unknown as {
    validateXML: (o: unknown) => Promise<{ valid: boolean; errors: { rawMessage?: string; message?: string }[] }>;
  };
  const dir = dirname(schemaPath);
  const main = readFileSync(schemaPath, "utf8");
  const preload = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".xsd") && join(dir, f) !== schemaPath)
    .map((f) => ({ fileName: f, contents: readFileSync(join(dir, f), "utf8") }));
  const r = await mod.validateXML({
    xml: [{ fileName: "entry.xml", contents: xml }],
    schema: [{ fileName: "entry.xsd", contents: main }],
    preload,
  });
  return r.valid ? "ok" : r.errors.map((e) => e.rawMessage ?? e.message ?? "validation error");
}

/**
 * Validates well-formedness and then the schema. Uses the system `xmllint` when installed, otherwise the bundled
 * `xmllint-wasm` package (so Windows works without extra tools).
 * "valid" means: well-formed AND the schema check ran AND passed. It never means the entry is correct or accepted.
 */
export async function validateXml(xml: string, dir = SCHEMA_DIR, opts: { backend?: "xmllint" | "xmllint-wasm" } = {}): Promise<ValidationResult> {
  const s = pickSchema(dir);
  const base = { schema: s.schema, schemaPath: s.path, complete: s.complete, note: s.note };
  const none = (msg: string): ValidationResult => ({ ...base, valid: false, errors: [msg], backend: "none", syntax: { ok: false, errors: [] }, xsd: { ran: false, ok: false },
    complete: false, note: "No schema validation was performed." });
  if (!existsSync(s.path)) return none(`Schema file not found: ${s.path}`);
  let backend: ValidationResult["backend"] = "xmllint";
  let outcome: string[] | "ok";
  try {
    if (opts.backend !== "xmllint-wasm" && (opts.backend === "xmllint" || (await hasNativeXmllint()))) outcome = await viaNative(xml, s.path);
    else { backend = "xmllint-wasm"; outcome = await viaWasm(xml, s.path); }
  } catch (e) {
    return none(`No XML validator available (${(e as Error).message.slice(0, 160)}). Install xmllint or the xmllint-wasm dependency.`);
  }
  if (outcome === "ok") return { ...base, valid: true, errors: [], backend, syntax: { ok: true, errors: [] }, xsd: { ran: true, ok: true } };
  const syntaxErrors = outcome.filter((l) => SYNTAX_RE.test(l));
  const syntaxOk = syntaxErrors.length === 0;
  return { ...base, valid: false, errors: outcome, backend, syntax: { ok: syntaxOk, errors: syntaxErrors }, xsd: { ran: syntaxOk, ok: false } };
}

/** Which validator and schema would be used right now (for the health endpoint and the settings dialog). */
export async function validatorStatus(dir = SCHEMA_DIR): Promise<{ backend: ValidationResult["backend"]; schema: SchemaInfo["schema"]; complete: boolean }> {
  const s = pickSchema(dir);
  if (await hasNativeXmllint()) return { backend: "xmllint", schema: s.schema, complete: s.complete };
  try { await import("xmllint-wasm"); return { backend: "xmllint-wasm", schema: s.schema, complete: s.complete }; }
  catch { return { backend: "none", schema: s.schema, complete: false }; }
}

export async function availableBackends(): Promise<("xmllint" | "xmllint-wasm")[]> {
  const out: ("xmllint" | "xmllint-wasm")[] = [];
  if (await hasNativeXmllint()) out.push("xmllint");
  try { await import("xmllint-wasm"); out.push("xmllint-wasm"); } catch { /* not installed */ }
  return out;
}
