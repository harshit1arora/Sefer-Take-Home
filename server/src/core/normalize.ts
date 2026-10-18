// Normalisation helpers. Each encodes a rule found in NetCHB's data_type.xsd or CBP guidance.
export function sanitizeInvoiceNo(raw: string): { value: string; changed: boolean; truncated: boolean } {
  // data_type.xsd invoiceNoType: [A-Za-z\d\-]{1,17}
  let v = raw.trim().replace(/[^A-Za-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  const truncated = v.length > 17;
  if (truncated) v = v.slice(0, 17);
  return { value: v, changed: v !== raw, truncated };
}

/** True only for a real calendar date in YYYY-MM-DD form (rejects impossible dates such as 2026-02-31). */
export function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** "12/09/2026" is ambiguous. Prefer the reading that is not after `notAfter` (e.g. the B/L date). */
export function parseDocDate(s: string, opts: { notAfter?: string } = {}): { iso: string; ambiguous: boolean } {
  const t = s.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) { if (!isRealDate(t)) throw new Error(`Impossible date: ${s}`); return { iso: t, ambiguous: false }; }
  const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(t);
  if (!m) throw new Error(`Unparseable date: ${s}`);
  const [a, b, y] = [Number(m[1]), Number(m[2]), m[3]];
  const fmt = (mo: number, d: number) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dmy = fmt(b, a), mdy = fmt(a, b);
  const okD = isRealDate(dmy), okM = isRealDate(mdy);
  if (a > 12) { if (!okD) throw new Error(`Impossible date: ${s}`); return { iso: dmy, ambiguous: false }; }
  if (b > 12) { if (!okM) throw new Error(`Impossible date: ${s}`); return { iso: mdy, ambiguous: false }; }
  if (a === b) { if (!okD) throw new Error(`Impossible date: ${s}`); return { iso: dmy, ambiguous: false }; }
  if (opts.notAfter) {
    const nd = okD && dmy <= opts.notAfter, nm = okM && mdy <= opts.notAfter;
    if (nd && !nm) return { iso: dmy, ambiguous: false };
    if (nm && !nd) return { iso: mdy, ambiguous: false };
  }
  if (!okD && !okM) throw new Error(`Impossible date: ${s}`);
  return { iso: okD ? dmy : mdy, ambiguous: true }; // DD/MM preferred, flagged
}

export interface BillSplit { scac?: string; number: string; split: boolean }

/**
 * Split a printed bill number into SCAC + number ONLY when the printed value unambiguously starts with the
 * carrier's SCAC and the remainder is a plain bill number. The printed value is preserved verbatim as the
 * canonical number: characters are never stripped to force a match, and an unverifiable split is reported
 * (split=false) so the caller can require confirmation instead of emitting a silently normalised value.
 */
export function splitBill(scac: string | undefined, bill: string): BillSplit {
  const printed = (bill ?? "").trim();
  const s = scac?.trim().toUpperCase();
  if (!printed) return { ...(s ? { scac: s } : {}), number: "", split: false };
  if (s && printed.toUpperCase().startsWith(s) && printed.length > s.length) {
    const rest = printed.slice(s.length);
    if (/^[A-Za-z0-9]+$/.test(rest)) return { scac: s, number: rest, split: true };
  }
  return { ...(s ? { scac: s } : {}), number: printed, split: false };
}

const COUNTRY: Record<string, string> = {
  VIETNAM: "VN", "VIET NAM": "VN", BANGLADESH: "BD", CHINA: "CN", "CHINA (MAINLAND)": "CN", INDIA: "IN", INDONESIA: "ID",
  CAMBODIA: "KH", THAILAND: "TH", "HONG KONG": "HK", "HONG KONG SAR": "HK", TAIWAN: "TW", "TAIWAN, CHINA": "TW",
  PAKISTAN: "PK", TURKEY: "TR", MEXICO: "MX", "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US", USA: "US", "U.S.A.": "US",
  JAPAN: "JP", GERMANY: "DE", ITALY: "IT", MALAYSIA: "MY", "SOUTH KOREA": "KR", KOREA: "KR", "REPUBLIC OF KOREA": "KR",
  "SRI LANKA": "LK", PHILIPPINES: "PH", SPAIN: "ES", FRANCE: "FR", PORTUGAL: "PT", NETHERLANDS: "NL", BELGIUM: "BE",
  POLAND: "PL", ROMANIA: "RO", BULGARIA: "BG", EGYPT: "EG", MOROCCO: "MA", TUNISIA: "TN", JORDAN: "JO", ISRAEL: "IL",
  // "UK" is NOT an ISO 3166-1 alpha-2 code; the United Kingdom is "GB". Normalise the common aliases explicitly.
  "UNITED KINGDOM": "GB", UK: "GB", ENGLAND: "GB", SCOTLAND: "GB", WALES: "GB", "GREAT BRITAIN": "GB",
  "UNITED ARAB EMIRATES": "AE", UAE: "AE", "SAUDI ARABIA": "SA", SINGAPORE: "SG", AUSTRALIA: "AU", "NEW ZEALAND": "NZ",
  CANADA: "CA", BRAZIL: "BR", PERU: "PE", COLOMBIA: "CO", CHILE: "CL", ARGENTINA: "AR", ETHIOPIA: "ET", KENYA: "KE",
  MYANMAR: "MM", LAOS: "LA", "LAO PDR": "LA", NEPAL: "NP",
};
/** Officially assigned ISO 3166-1 alpha-2 codes (249). A merely two-letter string such as "ZZ" or "XX" is NOT a country. */
export const ISO_COUNTRY_CODES: ReadonlySet<string> = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "),
);
export const isIsoCountry = (c: string | undefined): boolean => !!c && ISO_COUNTRY_CODES.has(c.trim().toUpperCase());
/**
 * Normalise a country name or code to ISO 3166-1 alpha-2. A known name/alias is mapped FIRST (so "UK" -> "GB"),
 * then an assigned ISO code is passed through. Anything unrecognised returns undefined so the caller
 * can keep the value unresolved instead of inventing a code.
 */
export function toIso2(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const k = c.trim().toUpperCase().replace(/\s+/g, " ");
  if (COUNTRY[k]) return COUNTRY[k];
  return ISO_COUNTRY_CODES.has(k) ? k : undefined; // unassigned two-letter strings are NOT accepted
}

export interface PortInfo { code: string; status: "verified" | "assumed"; basis: string }
const US_PORTS: Record<string, PortInfo> = {
  TACOMA: { code: "3002", status: "verified", basis: "CBP CSMS 15-000496 and FDA port list: Tacoma, WA = 3002" },
  SEATTLE: { code: "3001", status: "verified", basis: "CBP CSMS 15-000496 and FDA port list: Seattle, WA = 3001" },
};
export function usPort(name?: string): PortInfo | undefined {
  const u = (name ?? "").toUpperCase();
  return Object.entries(US_PORTS).find(([k]) => u.includes(k))?.[1];
}
export function foreignPort(name?: string): PortInfo | undefined {
  const u = (name ?? "").toUpperCase();
  if (/HO CHI MINH|HCMC|SAIGON|CAT LAI/.test(u))
    return { code: "55224", status: "assumed",
      basis: "CBP ACE Appendix F lists 55224 = Ho Chi Minh City and 55225 = Tan Cang. The exact Schedule D port for the terminal named on the B/L is not resolved; confirm which code applies." };
  return undefined;
}

/** entry.xsd container-size enumeration. */
export const CONTAINER_SIZES = ["20 ft", "20 ft HC", "40 ft", "40 ft HC", "45 ft", "45 ft HC", "53 ft", "53 ft HC"] as const;

/**
 * Map a container size exactly as it is printed on a document ("20'GP", "40HC", "20 ft", "45", "40' High Cube")
 * to the value the entry.xsd enumeration accepts. Returns undefined when it cannot be recognised, so the
 * caller omits the optional element instead of emitting a value the schema rejects.
 */
export function normalizeContainerSize(raw?: string): string | undefined {
  if (!raw) return undefined;
  const u = raw.toUpperCase().replace(/[\s'"’`.\-]/g, "");
  // Strict allowlist: a size (20/40/45/53) with an OPTIONAL "FT" and an OPTIONAL documented type suffix.
  // Anything else (e.g. "40XYZ", "20FOO", "45UNKNOWN") is rejected, so the caller omits the element rather
  // than emitting a value that merely starts with a recognised size.
  const m = /^(20|40|45|53)(FT)?(GP|DV|STD|HC|HQ|HIGH|HIGHCUBE|CUBE)?$/.exec(u);
  if (!m) return undefined;
  const hc = /^(HC|HQ|HIGH|HIGHCUBE|CUBE)$/.test(m[3] ?? "");
  const base = `${m[1]} ft`;
  return hc ? `${base} HC` : base;
}

/** Container numbers are single tokens in the entry; remove any whitespace the extractor introduced. */
export const cleanContainerNumber = (n: string) => n.replace(/\s+/g, "").toUpperCase();
