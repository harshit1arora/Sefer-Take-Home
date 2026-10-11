// Starts the Express backend and the Vite frontend together. Works on Windows, macOS and Linux (no shell tricks).
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "package.json"));
const need = (path, hint) => { if (!existsSync(resolve(root, path))) { console.error(`Missing ${path}. ${hint}`); process.exit(1); } };
need("node_modules", "Run: npm run install:all");
need("server/node_modules/express", "Run: npm run install:all");
if (!existsSync(resolve(root, ".env"))) console.warn("No .env file: the API will start, but extraction needs GEMINI_API_KEY (copy .env.example to .env).");

const vitePkg = resolve(dirname(require.resolve("vite/package.json")));
const viteBin = resolve(vitePkg, JSON.parse(readFileSync(resolve(vitePkg, "package.json"), "utf8")).bin.vite ?? "bin/vite.js");
const procs = [
  ["api", [resolve(root, "server/src/index.ts")]],
  ["web", [viteBin, "dev"]],
].map(([name, args]) => {
  const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const tag = (stream, out) => stream.on("data", (b) => String(b).split(/\r?\n/).filter(Boolean).forEach((l) => out.write(`[${name}] ${l}\n`)));
  tag(child.stdout, process.stdout); tag(child.stderr, process.stderr);
  child.on("exit", (code) => { if (!stopping) { console.error(`[${name}] exited with code ${code}; stopping.`); stop(code ?? 1); } });
  return child;
});
let stopping = false;
function stop(code = 0) { stopping = true; procs.forEach((p) => { try { p.kill(); } catch { /* already gone */ } }); setTimeout(() => process.exit(code), 300); }
process.on("SIGINT", () => stop(0)); process.on("SIGTERM", () => stop(0));
console.log("Starting API on http://127.0.0.1:3001 and the web app (Vite prints its URL, usually http://localhost:5173)...");
