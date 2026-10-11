// Normalisation helpers. Each encodes a rule found in NetCHB's data_type.xsd or CBP guidance.
export function sanitizeInvoiceNo(raw: string): { value: string; changed: boolean } {
  // data_type.xsd invoiceNoType: [A-Za-z\d\-]{1,17}
  let v = raw.trim().replace(/[^A-Za-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  if (v.length > 17) v = v.slice(0, 17);
  return { value: v, changed: v !== raw };
}

/** "12/09/2026" is ambiguous. Prefer the reading that is not after `notAfter` (e.g. the B/L date). */
export function parseDocDate(s: string, opts: { notAfter?: string } = {}): { iso: string; ambiguous: boolean } {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return { iso: s, ambiguous: false };
  const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s.trim());
  if (!m) throw new Error(`Unparseable date: ${s}`);
  const [a, b, y] = [Number(m[1]), Number(m[2]), m[3]];
  const fmt = (mo: number, d: number) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (a > 12) return { iso: fmt(b, a), ambiguous: false };
  if (b > 12) return { iso: fmt(a, b), ambiguous: false };
  if (a === b) return { iso: fmt(a, b), ambiguous: false };
  const dmy = fmt(b, a), mdy = fmt(a, b);
  if (opts.notAfter) {
    const okD = dmy <= opts.notAfter, okM = mdy <= opts.notAfter;
    if (okD && !okM) return { iso: dmy, ambiguous: false };
    if (okM && !okD) return { iso: mdy, ambiguous: false };
  }
  return { iso: dmy, ambiguous: true }; // default DD/MM, flagged
}

export function splitBill(scac: string | undefined, bill: string): { scac?: string; number: string } {
  const clean = bill.replace(/[^A-Za-z0-9]/g, "");
  if (scac && clean.toUpperCase().startsWith(scac.toUpperCase()) && clean.length > scac.length)
    return { scac: scac.toUpperCase(), number: clean.slice(scac.length) };
  return { scac: scac?.toUpperCase(), number: clean };
}

const COUNTRY: Record<string, string> = {
  VIETNAM: "VN", "VIET NAM": "VN", BANGLADESH: "BD", CHINA: "CN", INDIA: "IN", INDONESIA: "ID",
  CAMBODIA: "KH", THAILAND: "TH", "HONG KONG": "HK", TAIWAN: "TW", PAKISTAN: "PK", TURKEY: "TR",
  MEXICO: "MX", "UNITED STATES": "US", USA: "US", "U.S.A.": "US",
};
export function toIso2(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const k = c.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(k) ? k : COUNTRY[k];
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
      basis: "CBP ACE Appendix F lists 55224 = Ho Chi Minh City and 55225 = Tan Cang; Cat Lai is not named, so confirm which one applies" };
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
  const u = raw.toUpperCase().replace(/[\s'"\-]/g, "");
  const m = /^(20|40|45|53)/.exec(u);
  if (!m) return undefined;
  const hc = /HC|HQ|HIGHCUBE/.test(u);
  const base = `${m[1]} ft`;
  return hc ? `${base} HC` : base;
}

/** Container numbers are single tokens in the entry; remove any whitespace the extractor introduced. */
export const cleanContainerNumber = (n: string) => n.replace(/\s+/g, "").toUpperCase();
