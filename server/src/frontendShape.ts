import type { InvoiceLine, Shipment } from "./core/types.ts";

/** Shape of `shipment` in the frontend's EntryResponse (src/features/entry/models.ts). */
export interface FrontendLine {
  id: string; style?: string; description: string; hsCode: string; quantity: number; unit?: string;
  unitPrice: number | null; amount: number | null; origin: string; freeOfCharge?: boolean;
}
export interface FrontendShipment {
  id: string; invoiceNumber: string; buyer: string; consignee: string; origin: string; destination: string;
  billOfLading: string; invoiceValue: number; freight: number; insurance: number; packages: number; grossWeight: number;
  netWeight?: number; volume?: number; commercialQuantity?: number; lines: FrontendLine[]; isDemo: boolean;
}

const COUNTRY_NAMES: Record<string, string> = {
  VN: "Vietnam", BD: "Bangladesh", CN: "China", IN: "India", ID: "Indonesia", KH: "Cambodia", TH: "Thailand", HK: "Hong Kong",
  TW: "Taiwan", PK: "Pakistan", TR: "Turkey", MX: "Mexico", US: "United States",
};
export const countryName = (c: string) => COUNTRY_NAMES[c.toUpperCase()] ?? c.toUpperCase();

const title = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (m) => m.toUpperCase());
/** "TACOMA, WA, U.S.A." -> "Tacoma, WA" */
export function formatPlace(raw: string | undefined): string {
  if (!raw) return "";
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const state = parts.find((p, i) => i > 0 && /^[A-Z]{2}$/.test(p));
  return state ? `${title(parts[0] ?? "")}, ${state}` : parts.map(title).slice(0, 2).join(", ");
}

export const lineId = (l: Pick<InvoiceLine, "lineNo">) => `line-${l.lineNo}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function toFrontendShipment(s: Shipment, htsByStyle: Record<string, string> = {}): FrontendShipment {
  const inv = s.invoice, paid = inv.lines.filter((l) => !l.isFreeOfCharge);
  const origins = [...new Set(inv.lines.map((l) => countryName(l.originCountry)))];
  const out: FrontendShipment = {
    id: `shipment-${inv.number.replace(/[^A-Za-z0-9]+/g, "-")}`,
    invoiceNumber: inv.number,
    buyer: inv.buyer.name,
    consignee: (inv.shipTo ?? inv.buyer).name,
    origin: origins.join(" / "),
    destination: formatPlace(inv.portOfDischarge ?? s.bol.portOfDischarge),
    billOfLading: s.bol.houseBill,
    invoiceValue: inv.statedTotal ?? r2(paid.reduce((n, l) => n + l.statedAmount, 0)),
    freight: inv.freight ?? 0,
    insurance: inv.insurance ?? 0,
    packages: s.bol.packages,
    grossWeight: s.bol.grossKg,
    commercialQuantity: paid.reduce((n, l) => n + l.quantity, 0),
    isDemo: false,
    lines: inv.lines.map((l) => ({
      id: lineId(l), style: l.style, description: l.description, hsCode: htsByStyle[l.style] ?? l.hts ?? "",
      quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, amount: l.amountOverride ?? l.statedAmount,
      origin: countryName(l.originCountry), freeOfCharge: l.isFreeOfCharge,
    })),
  };
  if (s.packing.netKg !== undefined) out.netWeight = s.packing.netKg;
  if (s.packing.cbm !== undefined) out.volume = s.packing.cbm;
  return out;
}
