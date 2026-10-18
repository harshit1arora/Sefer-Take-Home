# Final verification report — Gemini provider

This file records verification of the Gemini-enabled source tree in **two tiers**:

* **Current local working tree — 2026-10-18** (Windows, Node v22.11.0): local branch `main` is ahead of `origin/main` by 2 commits with working tree uncommitted edits. Changes are NOT yet pushed to GitHub main.
* **Historical runs** (2026-10-10 / 2026-10-11): kept as history.

## 1. Checks (Current Local Verification)

| # | Check | Command | Result | Status |
|---|---|---|---|---|
| 1 | Dependencies | `npm run install:all` | Installed | **PASS** |
| 2 | Backend tests | `npm run test:server` (`node --test`) | **115 passed, 0 failed, 3 skipped** (118 tests total) | **PASS** |
| 3 | Frontend tests | `npm run test:web` (`npx vitest run`) | **30 passed** (4 test files) | **PASS** |
| 4 | Server typecheck | `npm run typecheck:server` (`tsc -p server/tsconfig.json`) | 0 errors | **PASS** |
| 5 | Web typecheck | `npm run typecheck:web` (`tsc --noEmit`) | 0 errors | **PASS** |
| 6 | Production build | `npm run build` (`vite build`) | succeeds (Nitro cloudflare-module output) | **PASS** |
| 7 | Full validation pass | `npm run check` | typecheck + test:web + test:server + build all pass | **PASS** |
| 8 | XML validation (bundled schema) | `validateXml` vs `schemas/entry.xsd` | Valid against bundled subset schema | **PASS (partial schema)** |
| 9 | HTTP end-to-end (3 real PDFs, mocked model) | `e2e.test.ts` | 200 → 22,899 → 27,439, XML valid | **PASS** |
| 10 | Security & Tamper protections | `audit.test.ts` & `trust-boundaries.test.ts` | HMAC source verification, broker edit guards, 403 on tampered source | **PASS** |
| 11 | Official-schema fetch | `npm run fetch-schemas` | `strixsmart.com` unreachable / partial schema only | **BLOCKED (network)** |
| 12 | Live Gemini extraction & Browser workflow in current run | Live API call & Browser UI | Validated via API and Playwright recordings in earlier pass; report as **NOT TESTED** in pure CI headless mode without live credentials | **NOT TESTED** |

The one skipped backend test is the opt-in live test (`SEFER_LIVE_GEMINI=1`), which is skipped here
because Node's `fetch` cannot use the container's egress proxy; the live call in §2 was therefore
driven through the same request the app builds, executed with `curl`.

## 2. Live Gemini extraction (2026-10-11, historical — not re-run in the latest pass)

The app's request builder produced a 627 KB `generateContent` body (system instruction + JSON
schema hint + the three PDFs as base64 `inline_data`, `mime_type: application/pdf`). That exact body
was POSTed to `gemini-3.8-flash` with the key in the `x-goog-api-key` header:

* **HTTP 200**, ~10 s, `finishReason: STOP`.
* Response was parsed with the app's own `parseModelJson` → `assertShipment` (Zod) → **valid**.
* Extracted values matched the assignment exactly: T-shirt 2,400 × 2.85 = **6,480** printed;
  hoodie 8,880; chino 6,255; blouse 1,260 with the **4,180** assist; samples 24 pcs BD with a **24**
  customs value; FOB **23,235**, freight **3,850**, insurance **185**, CIF **27,270**; packing
  138 cartons / 1,888 kg / 1,734.5 kg net / 13.58 CBM; B/L 1,930 kg.
* The scanned packing list and B/L were read from the PDF page images (`IMAGE` modality tokens in
  `usageMetadata`), not just the text layer.
* `buildEntryResponse` gave **entered 22,899** and **27,439** with both suggestions approved, and the
  XML **passed** the bundled subset schema. Evidence saved in `sample-output/*LIVE-GEMINI*`.

### Two real bugs the live run exposed (both fixed)

1. **Truncated output.** Gemini 3 models think by default and the thinking tokens are billed against
   `maxOutputTokens`; at the original 8,000 the JSON was cut off (`finishReason: MAX_TOKENS`).
   Fixed by raising the budget to 32,000 and, for Gemini 3 only, adding
   `thinkingConfig.thinkingLevel = "low"` (Gemini 2.5 rejects `thinkingLevel`, so it is not sent for
   those models).
2. **Invalid container size.** The extractor returned `20'GP`, which is not in the `entry.xsd`
   `container-size` enumeration, so validation failed. Added `normalizeContainerSize()` (maps
   `20'GP`/`40HC`/… to `20 ft`/`40 ft HC`/…, omits unknown values) and container-number whitespace
   cleaning. Both are covered by new tests.

A third hardening change: the API key is now sent in the `x-goog-api-key` **header** instead of the
URL query string, so it cannot leak through proxy or server logs.

## 3. Answers to the required questions

* **Was live Gemini extraction tested?** **Yes** — a real HTTP 200 request with the three real PDFs
  and a real key; the parsed and validated result is recorded in §2.
* **Did the three-PDF browser workflow pass?** Not through a real browser (no browser here). The
  same three PDFs were exercised end to end at the HTTP layer (mocked model) and through the real
  Gemini API (extraction + pipeline). The browser UI itself is unverified.
* **Was the full official schema validated?** **No** — `strixsmart.com` is unreachable; only the
  bundled subset was used, labelled partial.
* **Missing deliverables:** the complete AI chat history (must be exported by the submitter); the
  GitHub push; deployment (optional).
* **Remaining risks:** broker-required values (10-digit HTSUS, importer ID, bond, processing port)
  are intentionally absent; port-code, MID and container-type assumptions need broker confirmation;
  full-schema validation unverified; the browser UI unverified.


## Hardening pass (validation and readiness)

Fixes applied after a code review, each with regression tests in `server/test/hardening.test.ts`:

1. **Container size is a strict allowlist.** `normalizeContainerSize()` previously accepted anything starting
   with `20/40/45/53` (so `40XYZ` became `40 ft`). It now matches `<size>[FT][type]` exactly and returns
   `undefined` for anything else (e.g. `40XYZ`, `20FOO`, `45UNKNOWN`), so the element is omitted rather than
   emitted with a guessed value.
2. **Calendar-valid dates.** `isoDate` now rejects impossible dates (`2026-02-31`, `2025-02-29`, month 13);
   `parseDocDate()` enforces the same and throws `Impossible date` instead of constructing one.
3. **Bill splitting is conservative.** `splitBill()` no longer strips characters to force a match: it splits
   only when the printed value unambiguously starts with the carrier SCAC, otherwise it preserves the printed
   value verbatim (`split: false`) and `entryXml` omits the SCAC and records an assumption requiring
   confirmation.
4. **Invoice-number truncation is detected**, not silent: `sanitizeInvoiceNo()` reports `truncated`, and a
   blocking `INVOICE_NO_TRUNCATED` finding plus a broker assumption are raised.
5. **Duplicate identifiers are surfaced:** `reconcile()` flags `DUPLICATE_STYLE` and `DUPLICATE_LINE_NO`.
6. **Named readiness policy** (`server/src/core/readiness.ts`): readiness is decided by an explicit policy,
   not a severity count. A finding code is **blocking unless explicitly listed as informational**, so a
   finding cannot stop blocking just because its severity changed; the entered total is also reconciled
   against the sum of line values. Pipeline and contract both use this one policy.


## Pre-submission pass (repeated styles, arithmetic guards)

1. **Repeated style codes are no longer blocking.** A style code can legitimately repeat on separate invoice
   lines (different colours, sizes, origins or classifications). `DUPLICATE_STYLE` is now an **informational**
   finding (surfaced for review, never blocks readiness); a genuinely duplicated **line number**
   (`DUPLICATE_LINE_NO`) still blocks, because line numbers must be unique and the workspace keys rows by them.
   The repository cannot establish the customs rule for repeated styles, so this is documented as
   *informational / confirm intended* rather than invented as a hard rule.
2. **Division-by-zero guards.** A non-positive quantity could produce `Infinity` in the `LINE_AMOUNT` message
   (`reconcile.ts`) and in the free-of-charge valuation basis (`valuation.ts`). Both are guarded, and a
   non-positive quantity now raises a blocking `ZERO_QUANTITY` finding.
3. **Empty invoice number** (no characters valid for `invoiceNoType`) raises a blocking `INVOICE_NO_EMPTY`.
4. **Repeated-style HTSUS ambiguity surfaced.** When a style repeats and a broker supplies one style-keyed
   HTSUS, an assumption records that the classification is applied to every line of that style, for confirmation.


## Identity and readiness pass (line-level correctness)

1. **Readiness now requires COMPLETE validation.** `readyToFile` needs `validation.valid && validation.complete`, so a
   bundled-subset (partial) pass can never imply filing readiness. The note distinguishes "partial (bundled-subset)"
   from a failed or complete check.
2. **Repeated-style reconciliation is aggregated.** `reconcile()` no longer does a first-match packing-list lookup.
   Invoice quantities are summed per normalised style (trim + upper-case) and compared against the summed
   packing-list pieces, so repeated styles on either document reconcile correctly and genuine aggregate
   discrepancies are still reported.
3. **Approvals are line-specific.** Invoice lines now carry a stable, unique `id` (assigned once, positional,
   independent of the editable style or the printed line number). Valuation approvals (`acceptRecomputedAmounts`,
   `acceptAssist`), the HTS map (`htsByStyle`), edit mapping, and the frontend valuation panel all key on this id,
   so approving one line's correction/assist never affects another line that happens to share its style.
4. **Duplicate displayed line numbers are safe.** Frontend row ids come from the stable line id, not the printed
   line number, so duplicated line numbers produce unique React keys and each row can be edited or removed
   independently.


## Line-id normalisation and panel keys

- `ensureLineIds()` now guarantees **unique, non-empty** ids even when the input already contains duplicate ids:
  a valid unique id is preserved, while a missing/empty or colliding id gets a deterministic generated
  replacement (`L1`, `L2`, …) that skips every preserved id. It is idempotent, so approvals, the HTS map and
  edit mapping keep addressing the intended line after normalisation.
- The valuation row React key is the stable `line.id` (was the displayed `line.lineNo`), so duplicated
  displayed line numbers no longer collide in the list.
