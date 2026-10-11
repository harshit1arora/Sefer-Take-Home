# Verification history

**Historical.** This document contains results from the earlier Anthropic-backed implementation. The authoritative, current results (Gemini provider, including a live extraction) are in `docs/FINAL-VERIFICATION.md`. The extraction provider has since been changed to Google Gemini. Those results are historical and **must not be treated as verification of the current Gemini request format**.

For the current source, run from the repository root:

```powershell
npm run install:all
npm run check
npm run fetch-schemas
```

The current Gemini integration is covered by mocked API-response tests. A live Gemini request requires a valid `GEMINI_API_KEY` configured in `.env`. Full official schema validation requires network access to the Strix schema endpoint. A manual browser workflow should be performed after starting the app with `npm run dev`.

Do not report live extraction, browser validation, or full-schema validation as passing unless each was actually executed.
