# Sarvam history — what is and is not available

This note exists because Sarvam could not produce a **complete, byte-exact export** of its own
conversation for this project. It is deliberately explicit so nothing here is mistaken for a full
transcript. Per the integration instructions, no transcript was fabricated to fill the gaps.

## What IS available (and where it is)

| Item | Status | Where |
|---|---|---|
| The user prompts of the working session, verbatim | **Available** | [`sarvam-sefer-conversation.md`](sarvam-sefer-conversation.md) |
| Summaries of the assistant's replies in that session | **Available (summarised, not verbatim)** | [`sarvam-sefer-conversation.md`](sarvam-sefer-conversation.md) |
| The Google Gemini API key the user supplied | **Redacted** | replaced with `[REDACTED: API KEY]` in the same file |
| The Claude side of the work | **Available** (supplied export) | [`claude-sefer-conversation.md`](claude-sefer-conversation.md) |
| Executed checks and their results | **Available** | [`../FINAL-VERIFICATION.md`](../FINAL-VERIFICATION.md), [`../test-results.txt`](../test-results.txt) |

## What is NOT available

* **A verbatim assistant transcript.** The interface does not give Sarvam a byte-exact export of its
  own messages, so the assistant side is recorded as clearly-labelled summaries. Do not treat those
  summaries as quotations.
* **Tool-call transcripts.** Tool arguments, tool results, sub-agent output and intermediate command
  output are not reproduced. Only conclusions that were visible in the conversation are recorded.
* **Other or earlier sessions.** Only the messages in the working session thread are accessible.
  Any earlier Sarvam sessions about this project are not represented and were not invented.
* **A "Sarvam account export".** There is no equivalent of the Claude `conversations.json` export for
  Sarvam available here.

## How this differs from a verification report

[`../FINAL-VERIFICATION.md`](../FINAL-VERIFICATION.md) and [`../test-results.txt`](../test-results.txt)
are **reports of executed commands and their results** — they are not a conversation. This directory is
the **conversation/history record**. Neither substitutes for the other; a report says what was run, a
transcript says what was said.

## How to provide a full Sarvam transcript

If a complete Sarvam transcript is required for the submission:

1. In the Sarvam chat interface, use the export/copy feature for the whole conversation (or copy the
   transcript manually, message by message, from the first prompt to the last).
2. Save it as `docs/ai-history/sarvam-sefer-conversation-full.<txt|md|json>` **without** replacing this
   note, and update the provenance header in [`sarvam-sefer-conversation.md`](sarvam-sefer-conversation.md)
   to point at it.
3. Run the secret check in [`README.md`](README.md) before committing, and redact any API keys or tokens
   with a visible `[REDACTED: …]` marker.

Until that export exists, the accessible session record in
[`sarvam-sefer-conversation.md`](sarvam-sefer-conversation.md) is the honest maximum that can be
provided, and this note must stay with it.
