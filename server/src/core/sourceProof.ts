// Tamper-evident proof that a Shipment "source" came out of THIS server's extraction endpoint.
// /regenerate accepts a client-held copy of the extraction (so the broker can edit and regenerate), but a client
// must not be able to fabricate source data and have it treated as verified extraction. The server therefore
// signs the extraction it returns and refuses any regenerate request whose source does not match its signature.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Per-process secret. Override with SOURCE_PROOF_SECRET (e.g. to survive restarts); otherwise proofs die with the process. */
let secret: Buffer = process.env["SOURCE_PROOF_SECRET"] ? Buffer.from(process.env["SOURCE_PROOF_SECRET"]) : randomBytes(32);
/** Test hook only. */
export function setSourceProofSecret(s: string | Buffer): void { secret = Buffer.from(s); }

/** Key-order independent JSON so the signature survives a JSON round trip through the browser. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export function signSource(source: unknown): string {
  return createHmac("sha256", secret).update(canonicalJson(source)).digest("hex");
}

export function verifySource(source: unknown, proof: unknown): boolean {
  if (typeof proof !== "string" || !/^[0-9a-f]{64}$/.test(proof)) return false;
  const expected = Buffer.from(signSource(source), "hex"), given = Buffer.from(proof, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
