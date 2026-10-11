import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { DEFAULT_MODEL, isGeminiModelId, resolveModel } from "./core/extract.ts";

// Load .env from the repo root (preferred) or server/. Real environment variables win. Keys are never printed.
const here = dirname(fileURLToPath(import.meta.url));
for (const p of [resolve(here, "../../.env"), resolve(here, "../.env")]) {
  if (existsSync(p)) { try { process.loadEnvFile(p); } catch { /* malformed .env: ignore, health reports missing key */ } }
}
const apiKey = process.env["GEMINI_API_KEY"]?.trim();
const configuredModel = process.env["GEMINI_MODEL"]?.trim();
const usableKey = apiKey && !/^(your|changeme|replace-me)/i.test(apiKey) ? apiKey : undefined; // ignore .env.example placeholders
// Only a Gemini API model id is passed through; anything else falls back to the documented default.
const model = resolveModel(configuredModel);
// Never let an unexpected rejection or exception take the process down silently. Log the error CLASS only:
// upstream errors can carry request metadata or credentials in their message.
process.on("unhandledRejection", (reason) => console.error("[server] unhandledRejection:", reason instanceof Error ? reason.name : typeof reason));
process.on("uncaughtException", (err) => console.error("[server] uncaughtException:", err instanceof Error ? err.name : typeof err));

const app = createApp({ apiKey: usableKey, model });
const port = Number(process.env["PORT"] ?? 3001);
const host = process.env["HOST"] ?? "127.0.0.1"; // loopback only by default: this tool handles customs documents
app.listen(port, host, () => {
  console.log(`Sefer entry API listening on http://${host}:${port}`);
  console.log(`Extraction model: ${model}${configuredModel && isGeminiModelId(configuredModel) ? "" : " (default)"}`);
  console.log(usableKey ? "Extraction API key: configured" : "Extraction API key: NOT configured (set GEMINI_API_KEY in .env)");
  if (configuredModel && !isGeminiModelId(configuredModel)) {
    console.warn(`GEMINI_MODEL="${configuredModel}" is not a Gemini API model id; using the documented default ${DEFAULT_MODEL}.`);
  }
});
