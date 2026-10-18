import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assessReadiness } from "../src/core/readiness.ts";
import { reconcile } from "../src/core/reconcile.ts";
import { computeValuation } from "../src/core/valuation.ts";
import { ensureLineIds } from "../src/core/lineIds.ts";
import { applyEdits } from "../src/edits.ts";
import { toFrontendShipment } from "../src/frontendShape.ts";
import type { Shipment } from "../src/core/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sample = (): Shipment => JSON.parse(readFileSync(resolve(root, "fixtures/sample-shipment.json"), "utf8"));
const emptyReadiness = (validation: unknown) => assessReadiness({
  validation: validation as any, missing: [], assumptions: [],
  valuation: { lines: [], entered: 0, pending: 0 } as any, findings: [],
});

// ---------- 1. readiness respects schema completeness ----------
test("readiness: a valid-but-incomplete (bundled-subset) schema check is NOT ready to file", () => {
  const r = emptyReadiness({ valid: true, complete: false });
  assert.equal(r.readyToFile, false);
  assert.match(r.note, /PARTIAL|bundled-subset/i);
});
test("readiness: a valid AND complete schema check with no open items is ready", () => {
  assert.equal(emptyReadiness({ valid: true, complete: true }).readyToFile, true);
});
test("readiness: a failed schema check is not ready even if complete", () => {
  assert.equal(emptyReadiness({ valid: false, complete: true }).readyToFile, false);
});

// ---------- 2. repeated-style reconciliation ----------
test("reconcile: repeated invoice styles are compared as an aggregate, not first-match", () => {
  const s = sample(); const b = s.invoice.lines[0];
  s.invoice.lines = [
    { ...b, lineNo: 1, style: "SAME", quantity: 100, unitPrice: 1, statedAmount: 100 },
    { ...b, lineNo: 2, style: "SAME", quantity: 200, unitPrice: 1, statedAmount: 200 },
  ];
  s.packing.lines = [{ style: "SAME", pcs: 300 }];
  assert.equal(reconcile(s).filter((f) => f.code === "QTY_MISMATCH").length, 0);
});
test("reconcile: repeated PACKING-LIST styles are aggregated too", () => {
  const s = sample(); const b = s.invoice.lines[0];
  s.invoice.lines = [{ ...b, lineNo: 1, style: "SAME", quantity: 300, unitPrice: 1, statedAmount: 300 }];
  s.packing.lines = [{ style: "SAME", pcs: 100 }, { style: "SAME", pcs: 200 }];
  assert.equal(reconcile(s).filter((f) => f.code === "QTY_MISMATCH").length, 0);
});
test("reconcile: style keys are case-insensitive and whitespace-normalised", () => {
  const s = sample(); const b = s.invoice.lines[0];
  s.invoice.lines = [{ ...b, lineNo: 1, style: "same", quantity: 300, unitPrice: 1, statedAmount: 300 }];
  s.packing.lines = [{ style: "  SAME ", pcs: 300 }];
  const f = reconcile(s);
  assert.equal(f.filter((x) => x.code === "QTY_MISMATCH").length, 0);
  assert.equal(f.filter((x) => x.code === "STYLE_MISSING_PL").length, 0);
});
test("reconcile: a genuine aggregate quantity discrepancy is still reported", () => {
  const s = sample(); const b = s.invoice.lines[0];
  s.invoice.lines = [
    { ...b, lineNo: 1, style: "SAME", quantity: 100, unitPrice: 1, statedAmount: 100 },
    { ...b, lineNo: 2, style: "SAME", quantity: 200, unitPrice: 1, statedAmount: 200 },
  ];
  s.packing.lines = [{ style: "SAME", pcs: 250 }];
  const m = reconcile(s).find((f) => f.code === "QTY_MISMATCH");
  assert.ok(m, "discrepancy reported");
  assert.match(m!.message, /invoice 300 vs packing list 250 \(difference 50\)/);
});

// ---------- 3. approvals are line-specific ----------
test("approvals: two lines sharing a style with different corrections are approved independently", () => {
  const s = sample(); const b = s.invoice.lines[0];
  s.invoice.lines = [
    { ...b, lineNo: 1, style: "SAME", quantity: 10, unitPrice: 1, statedAmount: 8 }, // delta +2
    { ...b, lineNo: 2, style: "SAME", quantity: 10, unitPrice: 1, statedAmount: 5 }, // delta +5
  ];
  const v = computeValuation(s, { acceptRecomputedAmounts: ["L1"] });
  const delta = (i: number) => v.lines[i].components.find((c) => c.id === "recomputed-delta")!;
  assert.equal(delta(0).included, true); assert.equal(delta(0).amount, 2);
  assert.equal(delta(1).included, false); assert.equal(delta(1).amount, 5);
});
test("approvals: two lines sharing a style with different assists are approved independently", () => {
  const s = sample(); const b = s.invoice.lines[0];
  s.invoice.lines = [
    { ...b, lineNo: 1, style: "SAME", quantity: 10, unitPrice: 1, statedAmount: 10, assistValue: 100 },
    { ...b, lineNo: 2, style: "SAME", quantity: 10, unitPrice: 1, statedAmount: 10, assistValue: 200 },
  ];
  const v = computeValuation(s, { acceptAssist: ["L2"] });
  const assist = (i: number) => v.lines[i].components.find((c) => c.id === "assist")!;
  assert.equal(assist(0).included, false);
  assert.equal(assist(1).included, true);
  assert.equal(v.lines[0].value, 10); assert.equal(v.lines[1].value, 210);
});

// ---------- 4. duplicate displayed line numbers are still individually editable ----------
test("duplicate source line numbers yield unique frontend ids and independent edit/remove", () => {
  const s = sample();
  s.invoice.lines[1].lineNo = s.invoice.lines[0].lineNo; // duplicate displayed number
  const fe = toFrontendShipment(s);
  const ids = fe.lines.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, "frontend ids must be unique");

  // edit only the second offending row
  const editFe = toFrontendShipment(s);
  editFe.lines[1].quantity = 777;
  const edited = applyEdits(ensureLineIds(s), editFe);
  assert.equal(edited.working.invoice.lines[1].quantity, 777);
  assert.equal(edited.working.invoice.lines[0].quantity, s.invoice.lines[0].quantity, "first row untouched");

  // remove only the second offending row
  const delFe = toFrontendShipment(s);
  delFe.lines = delFe.lines.filter((l) => l.id !== ids[1]);
  const removed = applyEdits(ensureLineIds(s), delFe);
  assert.equal(removed.working.invoice.lines.length, s.invoice.lines.length - 1);
  assert.equal(removed.working.invoice.lines[0].style, s.invoice.lines[0].style, "the other row survives");
});

// ---------- ensureLineIds: uniqueness, preservation, determinism, idempotence ----------
test("ensureLineIds: duplicate ids are replaced, unique ids preserved, missing/empty ids filled", () => {
  const s = sample();
  s.invoice.lines[0].id = "L1";
  s.invoice.lines[1].id = "L1";   // collision with line 0
  s.invoice.lines[2].id = "KEEP"; // unique + non-empty -> must be preserved
  delete s.invoice.lines[3].id;   // missing
  s.invoice.lines[4].id = "   ";  // whitespace-only -> treated as missing
  const ids = ensureLineIds(s).invoice.lines.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  assert.ok(ids.every((id) => typeof id === "string" && id.trim().length > 0), "ids must be non-empty");
  assert.ok(ids.includes("KEEP"), "a valid unique existing id is preserved");
  assert.deepEqual(ensureLineIds(s).invoice.lines.map((l) => l.id), ids, "deterministic for identical input");
  assert.deepEqual(ensureLineIds(ensureLineIds(s)).invoice.lines.map((l) => l.id), ids, "idempotent");
});

test("ensureLineIds: a mixed case of duplicates, misses and unique ids stays stable", () => {
  const s = sample();
  s.invoice.lines[0].id = "X";
  s.invoice.lines[1].id = "X";
  s.invoice.lines[2].id = undefined as unknown as string;
  s.invoice.lines[3].id = "L1"; // collides with a GENERATED id if not reserved correctly
  s.invoice.lines[4].id = "X";
  const out = ensureLineIds(s);
  const ids = out.invoice.lines.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("L1"), "a unique existing id that looks generated is preserved");
  assert.deepEqual(ensureLineIds(out).invoice.lines.map((l) => l.id), ids, "idempotent");
});

test("ensureLineIds: approvals and edits still address the intended line after normalisation", () => {
  const s = sample();
  s.invoice.lines[0].id = "DUP"; s.invoice.lines[1].id = "DUP"; // force a collision
  const out = ensureLineIds(s);
  const id0 = out.invoice.lines[0].id!;
  assert.notEqual(id0, out.invoice.lines[1].id, "collision resolved");

  // approval keyed by the normalised id affects only that line
  const v = computeValuation(out, { acceptRecomputedAmounts: [id0] });
  assert.equal(v.lines[0].components.find((c) => c.id === "recomputed-delta")!.included, true);
  assert.ok(!v.lines[1].components.some((c) => c.id === "recomputed-delta" && c.included), "line 2 untouched");

  // edit keyed by the normalised id affects only that line
  const fe = toFrontendShipment(out);
  const feIds = fe.lines.map((l) => l.id);
  assert.equal(new Set(feIds).size, feIds.length);
  fe.lines[1].quantity = 4242;
  const res = applyEdits(out, fe);
  assert.equal(res.working.invoice.lines[1].quantity, 4242);
  assert.equal(res.working.invoice.lines[0].quantity, s.invoice.lines[0].quantity, "line 1 untouched");
});
