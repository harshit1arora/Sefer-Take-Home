# AI chat history

The AI conversation record for this project now lives in **[`ai-history/`](ai-history/)**.

| File | Contents |
|---|---|
| [`ai-history/claude-sefer-conversation.md`](ai-history/claude-sefer-conversation.md) | The Claude conversation export, preserved in order. |
| [`ai-history/sarvam-sefer-conversation.md`](ai-history/sarvam-sefer-conversation.md) | The accessible Sarvam session: user prompts verbatim, assistant replies summarised. |
| [`ai-history/SARVAM-HISTORY-STATUS.md`](ai-history/SARVAM-HISTORY-STATUS.md) | What Sarvam could and could not recover, and how to supply a full transcript. |
| [`ai-history/AI-WORKFLOW-SUMMARY.md`](ai-history/AI-WORKFLOW-SUMMARY.md) | Concise timeline of each tool's contribution. |
| [`ai-history/README.md`](ai-history/README.md) | Sources, limitations, redaction policy and how to update. |

Notes:

* The Claude transcript is the **primary** record for Claude's messages; the Sarvam file is the primary
  record for the Sarvam session. Assistant messages in the Sarvam file are **summaries**, not verbatim
  quotations, because this interface does not provide a byte-exact export of them.
* No transcript was fabricated. Where a full Sarvam export is unavailable, that is stated honestly in
  [`ai-history/SARVAM-HISTORY-STATUS.md`](ai-history/SARVAM-HISTORY-STATUS.md).
* Credentials are redacted with a visible `[REDACTED: …]` marker, and shipment identifiers have been
  sanitized to consistent fictional placeholders for this public repository. See the redaction policy
  in [`ai-history/README.md`](ai-history/README.md).
* Executed checks and their results are separate from the conversation; see
  [`FINAL-VERIFICATION.md`](FINAL-VERIFICATION.md) and [`test-results.txt`](test-results.txt).
