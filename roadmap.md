# Sefer Entry Workspace

Status as of the final repair/verification pass. Items are ticked only if they were actually verified; see `docs/FINAL-VERIFICATION.md` and `docs/test-results.txt`.

- [x] Brand-aligned workspace and reusable frontend controls (existing design preserved).
- [x] Typed models, editable shipment data, multipart API client (`documents`) and honest validation states.
- [x] Backend: extraction (model), Zod validation, reconciliation, provenance-based valuation, deterministic XML, XSD validation.
- [x] Configurable, documented extraction model (`GEMINI_MODEL`, default `gemini-3.8-flash`); no fabricated model id.
- [x] Backend and contract tests (67 passing + 1 opt-in live test skipped, with real dependencies); frontend tests under the real `vitest` + `jsdom` runner (26 passing).
- [x] `npm run install:all` from a clean checkout (reproducible; lockfiles committed).
- [x] `npm run typecheck` (frontend + server), `npm run build` and the full `npm test`.
- [x] HTTP end-to-end test: the three real PDFs through the real Express pipeline to a valid XML draft.
- [ ] `npm run fetch-schemas` and validation against the full official schema — **blocked in the build environment** (schema host unreachable).
- [x] Live Gemini extraction of the three real PDFs (`gemini-3.8-flash`, HTTP 200, Zod-validated, schema-valid XML); see `docs/FINAL-VERIFICATION.md`.
- [ ] Broker-approved HTSUS codes, importer ID, bond and processing port (never inferred).
