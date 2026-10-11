# Final verification report — Gemini provider

Generated 2026-10-11 in the verification container (Debian, Node v22.18.0). Every command below was
actually executed against this exact source tree; exit codes and counts are the real ones. A **live
Google Gemini extraction was performed** with a user-supplied key and the three real PDFs (see §2).

## 1. Checks

| # | Check | Command | Result | Status |
|---|---|---|---|---|
| 1 | Clean dependency install | `npm run install:all` | 325 frontend + 76 server packages | **PASS** |
| 2 | Backend tests | `node --experimental-strip-types --test "test/*.test.ts"` | **67 passed, 0 failed, 1 skipped** | **PASS** |
| 3 | Frontend tests | `npx vitest run` (real vitest + jsdom) | **26 passed** (2 files) | **PASS** |
| 4 | Server typecheck | `tsc -p server/tsconfig.json` | 0 errors | **PASS** |
| 5 | Web typecheck | `tsc --noEmit` | 0 errors | **PASS** |
| 6 | Production build | `npm run build` | succeeds (Nitro output) | **PASS** |
| 7 | XML validation (subset schema) | `lxml` vs `schemas/entry.xsd` | all four sample XML files VALID | **PASS (partial schema)** |
| 8 | Source trace vs real PDF | `node scripts/trace-source.mjs /scratch/input` | invoice 5/5 lines + 5/5 totals match | **PASS** |
| 9 | HTTP end-to-end (3 real PDFs, mocked model) | `e2e.test.ts` | 200 → 22,899 → 27,439, XML valid | **PASS** |
| 10 | **Live Gemini extraction (3 real PDFs)** | real `generateContent` call, then the app's own parser | **HTTP 200, Zod-validated, entered 22,899 / 27,439, XSD passed** | **PASS** |
| 11 | Official-schema fetch | `npm run fetch-schemas` | `strixsmart.com` unreachable | **BLOCKED (network)** |
| 12 | Browser UI run | manual | no browser in the container | **BLOCKED (no browser)** |

The one skipped backend test is the opt-in live test (`SEFER_LIVE_GEMINI=1`), which is skipped here
because Node's `fetch` cannot use the container's egress proxy; the live call in §2 was therefore
driven through the same request the app builds, executed with `curl`.

## 2. Live Gemini extraction (actually executed)

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
