# Repair and verification log (2026-10-10)

This file records changes made after reviewing the supplied workspace ZIP. It deliberately separates checks run here from checks that remain blocked.

## Changes made

- Hardened extraction-provider response handling in `server/src/core/extract.ts`: malformed JSON responses, unexpected response shapes, and empty text now return explicit upstream `502` errors rather than falling through as generic internal errors.
- Reduced sensitive-data exposure in server error logs: unexpected exception messages are no longer logged because upstream errors can include request metadata or credentials.
- Added regression cases for malformed upstream JSON, unexpected response shapes, and empty model text in `server/test/regression.test.ts`.
- Updated the server test command to enable Node's native TypeScript stripping for environments where it is still experimental. The declared project baseline remains Node 22.18+.
- Added `.nvmrc` with the baseline Node version.
- Regenerated `docs/source-trace.md` against the supplied invoice, packing-list, and B/L PDFs. Invoice text-layer amounts and totals match the fixture; scan OCR is explicitly treated as weak corroboration only.
- Clarified README verification notes so new regression cases are not represented as already executed.

## Checks actually run in this repair environment

- `node --experimental-strip-types --check server/src/api.ts` — passed (syntax check only).
- `node --experimental-strip-types --check server/src/app.ts` — passed (syntax check only).
- `node --experimental-strip-types --check server/src/core/extract.ts` — passed (syntax check only).
- `node --experimental-strip-types --check server/test/regression.test.ts` — passed (syntax check only).
- `node scripts/trace-source.mjs /mnt/data/sefer-work/sample-pdfs` — passed; all five invoice line items and five printed invoice totals match the fixture. OCR results for scanned documents are not definitive.
- Python `lxml` validation of both sample XML files against `schemas/entry.xsd` — passed against the **bundled subset XSD only**. This is not official full-schema verification.

## Blocked / not verified

- A clean npm dependency installation timed out in this environment; no `node_modules` were installed.
- Backend and frontend test suites, TypeScript checks, production build, Express upload test, browser workflow, and live provider extraction were not run after the changes.
- Full official NetCHB/Strix XSD download and validation remain unverified.
- The complete three-PDF workflow through the browser has not been executed here.

Do not treat this log as a claim of full end-to-end or customs filing readiness.


## Gemini provider migration

- Replaced the Anthropic request/response adapter with Google's Gemini `generateContent` REST API. Native PDF bytes are passed as `inline_data` and JSON output is requested.
- Changed configuration to `GEMINI_API_KEY` and `GEMINI_MODEL`; the documented default is `gemini-3.8-flash`.
- Updated setup instructions, health/error messaging, and README architecture diagram.
- Added/updated mocked request-format tests for Gemini. A real API request has **not** been made because no user API key is available in this workspace.
- Full official schema remains unverified because the previous network attempt timed out.
