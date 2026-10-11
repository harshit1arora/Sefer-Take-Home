# `docs/ai-history/` — AI assistance record

This directory holds the submission-ready record of the AI assistance used to build the Sefer NetCHB
entry workspace. It is documentation only: it does **not** change the application, and nothing in it is
part of the running app.

## Contents

| File | What it is | Primary or secondary |
|---|---|---|
| [`claude-sefer-conversation.md`](claude-sefer-conversation.md) | The Claude conversation export, preserved in order (30 messages). | **Primary** for Claude's messages |
| [`sarvam-sefer-conversation.md`](sarvam-sefer-conversation.md) | The accessible Sarvam session: user prompts verbatim, assistant replies summarised. | **Primary** for the Sarvam session |
| [`SARVAM-HISTORY-STATUS.md`](SARVAM-HISTORY-STATUS.md) | Exactly what Sarvam could and could not recover, and how to supply a full transcript. | Reference |
| [`AI-WORKFLOW-SUMMARY.md`](AI-WORKFLOW-SUMMARY.md) | Concise timeline of each tool's contribution. | **Secondary** (must not override the transcripts) |
| `README.md` | This file. | Reference |

The two transcripts are the sources of record; the summary links to them and does not duplicate them.

## Sources

* **Claude** — a plain-text export of the Sefer conversation supplied for this task. Its `text` fields
  are reproduced in order. Structured tool outputs, attachments and rendered artifacts may be absent
  from the plain-text export, so it is not a complete record of those items.
* **Sarvam** — the messages accessible in the working session that produced this repository. Only that
  session is represented; see [`SARVAM-HISTORY-STATUS.md`](SARVAM-HISTORY-STATUS.md).

## Limitations (read before publishing)

* **Assistant text is not always verbatim.** Claude's message bodies are preserved as exported;
  Sarvam's assistant messages are clearly-labelled **summaries** because the interface does not provide
  a byte-exact export of them.
* **Not a verification report.** Claims inside a conversation ("tests pass") are *reported*, not
  *proven*. Executed results live in [`../FINAL-VERIFICATION.md`](../FINAL-VERIFICATION.md) and
  [`../test-results.txt`](../test-results.txt).
* **Commercial data (sanitized).** The conversations discuss the sample shipment. Before publishing
  to a public repository, the shipment's identifying data was replaced with consistent fictional
  placeholders across the whole repository: party names (e.g. *Harborline Apparel Sourcing Limited*,
  *Bluepeak Outfitters, Inc.*, *Summit Fulfillment Partners LLC*, *Mekong Garment JSC*, *Example
  Garments Dhaka Ltd.*), street addresses, and shipment numbers (invoice `HLAS/BP/26-0912`, PO
  `BP-26-0918`, bills, container, seal, style codes). One tax ID was redacted. Quantities, amounts,
  origins and the technical explanation are unchanged, so the fixture still produces the expected
  sample output (entered 22,899 / 27,439).
* **No secrets.** API keys, tokens and passwords are not included. See the redaction policy below.

## Redaction policy

* Credentials are replaced with a **visible** marker, e.g. `[REDACTED: API KEY]`; unrelated message
  content is never altered.
* Two redaction steps were applied: (a) the Google Gemini API key in the user's Message 5 of the
  Sarvam session; (b) shipment identifiers sanitized to fictional placeholders across all files.
* `.env` and `.env.*` are git-ignored (only `.env.example` is kept), so no live key can be committed by
  accident.

Before committing any change to this directory, run a secret scan from the repository root:

```powershell
# PowerShell — flag anything that looks like a credential in this directory
Select-String -Path docs/ai-history/*.md -Pattern 'sk-ant-','AIza','AQ\.Ab8','api[_-]?key\s*[:=]','Bearer\s+[A-Za-z0-9._-]+'
```

A clean run prints nothing. If it prints a hit, redact it with a `[REDACTED: …]` marker before committing.

## How to update this history

1. **Add new Sarvam messages** to [`sarvam-sefer-conversation.md`](sarvam-sefer-conversation.md) in
   order. Keep user prompts verbatim; label assistant text as a summary unless you have a verbatim
   export.
2. **If a full Sarvam export becomes available**, save it as
   `docs/ai-history/sarvam-sefer-conversation-full.<txt|md|json>`, point the provenance header at it,
   and keep [`SARVAM-HISTORY-STATUS.md`](SARVAM-HISTORY-STATUS.md) updated.
3. **Do not invent messages, tool calls, or results.** If something is unknown, say so.
4. **Do not add the whole account export**, other conversations, or memory dumps — only the Sefer work.
5. Re-run the secret scan above, then update [`AI-WORKFLOW-SUMMARY.md`](AI-WORKFLOW-SUMMARY.md) if the
   contribution split changed.

## Related files

* Repository overview and how to run the app: [`../../README.md`](../../README.md)
* What was actually verified: [`../FINAL-VERIFICATION.md`](../FINAL-VERIFICATION.md)
* The pointer that used to hold the placeholder note: [`../AI-CHAT-HISTORY.md`](../AI-CHAT-HISTORY.md)
