import type { Shipment } from "./types.ts";

/**
 * Assign a STABLE, UNIQUE, NON-EMPTY id to every invoice line.
 *
 * - An existing id is PRESERVED when it is non-empty and unique across the shipment.
 * - A missing/empty id, or an id that collides with another line, is replaced by a deterministic
 *   generated id (`L1`, `L2`, ...) that skips every preserved id and every id already handed out.
 * - The function is idempotent: running it on its own output returns the same ids, and ids never
 *   depend on the editable style code or the printed line number (both of which may repeat).
 *
 * Because the result is unique and deterministic, valuation approvals, the HTS map and edit mapping
 * (all keyed by this id) continue to address exactly the intended line after normalisation.
 */
export function ensureLineIds(s: Shipment): Shipment {
  // Reserve ids that are already non-empty AND unique, so a generated replacement can never collide with one.
  const counts = new Map<string, number>();
  for (const l of s.invoice.lines) {
    const id = l.id?.trim();
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const reserved = new Set<string>();
  for (const [id, n] of counts) if (n === 1) reserved.add(id);

  const handedOut = new Set<string>();
  let n = 0;
  const nextFree = () => { let id: string; do { n += 1; id = `L${n}`; } while (reserved.has(id) || handedOut.has(id)); return id; };

  const lines = s.invoice.lines.map((l) => {
    const id = l.id?.trim();
    if (id && reserved.has(id) && !handedOut.has(id)) { handedOut.add(id); return l.id === id ? l : { ...l, id }; }
    const replacement = nextFree();
    handedOut.add(replacement);
    return { ...l, id: replacement };
  });
  return { ...s, invoice: { ...s.invoice, lines } };
}
