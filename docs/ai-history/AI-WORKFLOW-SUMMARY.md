# AI workflow summary — Sefer take-home

A concise, factual timeline of the AI assistance on this project. It is a **summary that points at the
primary sources**, not a replacement for them. The transcript lives once, in
[`claude-sefer-conversation.md`](claude-sefer-conversation.md) (Claude) and
[`sarvam-sefer-conversation.md`](sarvam-sefer-conversation.md) (Sarvam). Read those for the actual
messages; read [`SARVAM-HISTORY-STATUS.md`](SARVAM-HISTORY-STATUS.md) for what Sarvam could and could
not recover.

## How to read the status labels

Every row is tagged with how strong the evidence is:

* **Recorded** — an action or statement that appears in the source conversation itself.
* **Reported** — a claim made in a conversation (e.g. "tests pass") that is *not* independently
  re-checked here.
* **Verified** — actually executed in the current environment, with the result recorded in
  [`../FINAL-VERIFICATION.md`](../FINAL-VERIFICATION.md) and [`../test-results.txt`](../test-results.txt).

A *Reported* item is not evidence on its own; only *Verified* items were run here.

## Timeline

| Stage | Claude (source: `claude-sefer-conversation.md`) | Sarvam (source: `sarvam-sefer-conversation.md`) | Status |
|---|---|---|---|
| Assignment understood | First messages scope the take-home: extract data, research NetCHB's XML, generate entry XML, keep human review | Same brief re-confirmed against the three supplied PDFs | Recorded |
| NetCHB research | Discussion of the `entry.xsd` structure, ports, MID rule, assist and sample treatment | Re-read the same research; no new NetCHB claims added | Recorded / Reported |
| Extraction + discrepancy analysis | Identifies the T-shirt amount mismatch, hoodie quantity gap, weight difference, hand-corrected container, mixed origin | Confirmed the invoice text layer matches the fixture; the two scans are image-only | Recorded; invoice trace **Verified** |
| First implementation | Claude creates the frontend/backend implementation and iterates | Received it as a ZIP | Recorded |
| Data-integrity correction | Printed T-shirt amount preserved; the 360 correction and 4,180 assist kept as *suggestions* | Confirmed the same behaviour in the code and tests | Recorded; **Verified** by tests |
| Audit of the supplied ZIP | Later messages audit an existing ZIP for submission readiness | Found the ZIP did not run (duplicate `const content`, `vite.config.ts` type error); fixed both | Recorded; **Verified** |
| Anthropic → Gemini migration | (Anthropic era) | Inspected the Gemini migration in the supplied ZIP | Recorded |
| Model configuration | — | Removed a fabricated default model id; documented, configurable default | Recorded; **Verified** by tests |
| Live Gemini extraction | — | Real `generateContent` call with the three real PDFs: HTTP 200, Zod-validated, entered 22,899 / 27,439 | **Verified** |
| Live-run bug fixes | — | Token-budget truncation and invalid container size, both found only by the live run; fixed and covered by tests | **Verified** |
| Test suites | Earlier messages report test results for the Anthropic revision | 67 backend + 26 frontend tests run against the current tree | Reported (Claude era) / **Verified** (Sarvam, current tree) |
| Full official schema | Research notes the schema host; download attempts fail | `npm run fetch-schemas` still cannot reach the host | **Not verified (blocked)** |
| Browser workflow | — | No browser available; workflow exercised at the HTTP layer and via the live API | **Not verified (blocked)** |
| AI history integration | — | This directory | **Verified** (files present; checks run) |

## Contribution split, in one line each

* **Claude** produced the original design, the NetCHB research, the first implementation, and the
  data-integrity decisions (printed values preserved, corrections kept as suggestions). Source:
  [`claude-sefer-conversation.md`](claude-sefer-conversation.md).
* **Sarvam** audited the supplied ZIPs, fixed the defects that stopped it running, migrated and
  verified the Gemini integration (including a **live** call), reconciled the documentation, and
  integrated this history. Source: [`sarvam-sefer-conversation.md`](sarvam-sefer-conversation.md).

## Caveats

* The Claude transcript is the supplied plain-text export; structured tool outputs, attachments and
  rendered artifacts may be absent from it, so it is not a complete record of those items.
* Sarvam's assistant messages are recorded as summaries, not verbatim quotations.
* Where the two sources disagree, the transcript is primary and this summary must not override it.
