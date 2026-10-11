import type { Party } from "./types.ts";
import { toIso2 } from "./normalize.ts";
/** MID per 19 CFR Part 102 Appendix: ISO country + first 3 chars of first 2 words of name +
 *  first 4 digits of the largest number on the street line + first 3 letters of city. */
export function buildMid(p: Party | undefined, countryOverride?: string): { mid?: string; note: string } {
  if (!p) return { note: "no manufacturer party found" };
  const cc = toIso2(countryOverride ?? p.country);
  if (!cc || !p.name || !p.city) return { note: "name, city or country missing" };
  const words = p.name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const namePart = words.slice(0, 2).map((w) => w.slice(0, 3)).join("");
  const nums = (p.address1 ?? "").match(/\d+/g)?.map(Number) ?? [];
  const largest = nums.length ? String(Math.max(...nums)).slice(0, 4) : "";
  const city = p.city.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  const mid = `${cc}${namePart}${largest}${city}`;
  const multi = nums.length > 1 ? ` (street line has several numbers: ${nums.join(", ")})` : "";
  return { mid: mid.slice(0, 15), note: `derived from name/address${multi}` };
}
