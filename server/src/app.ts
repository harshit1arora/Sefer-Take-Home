import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { MAX_FILE_BYTES, MAX_FILES } from "./core/extract.ts";
import { handleEntryUpload, handleHealth, handleRegenerate, type ApiDeps, type ApiResult } from "./api.ts";

export function createApp(deps: ApiDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (_req: Request, res: Response, next: NextFunction) => { res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Cache-Control", "no-store"); next(); });
  // Uploads stay in memory only: nothing is written to disk, so uploaded PDFs cannot end up in the repository.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 8, fieldSize: 200_000, parts: MAX_FILES + 8 } });
  const send = (res: Response, r: ApiResult) => { res.status(r.status).json(r.body); };
  // Express 4 does not catch a rejected promise from an async handler; wrap them so any unexpected
  // rejection reaches the error middleware instead of hanging the request or crashing the process.
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

  app.get("/api/health", wrap(async (_req: Request, res: Response) => send(res, await handleHealth(deps))));

  app.post("/api/entry", upload.array("documents", MAX_FILES), wrap(async (req: Request, res: Response) => {
    const files = ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({ name: f.originalname, data: f.buffer }));
    const fields = (req.body ?? {}) as Record<string, string | undefined>;
    send(res, await handleEntryUpload(files, { broker: fields["broker"] }, deps));
  }));

  app.post("/api/entry/regenerate", express.json({ limit: "1mb" }), wrap(async (req: Request, res: Response) => send(res, await handleRegenerate(req.body, deps))));

  app.use("/api", (_req: Request, res: Response) => { res.status(404).json({ error: "Unknown API route.", code: "NOT_FOUND" }); });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { name?: string; code?: string; type?: string; message?: string };
    if (e?.name === "MulterError") {
      const status = e.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      const msg = e.code === "LIMIT_UNEXPECTED_FILE" ? "Upload PDFs in the multipart field 'documents' (at most " + MAX_FILES + " files)." : e.code === "LIMIT_FILE_SIZE" ? `Each PDF must be at most ${MAX_FILE_BYTES / 1024 / 1024} MB.` : "The upload was rejected.";
      res.status(status).json({ error: msg, code: e.code }); return;
    }
    if (e?.type === "entity.parse.failed" || e?.type === "entity.too.large") { res.status(e.type === "entity.too.large" ? 413 : 400).json({ error: "The request body is not valid JSON or is too large.", code: "BAD_REQUEST" }); return; }
    // Do not log raw error messages: upstream exceptions can contain secrets or request details.
    console.error("[server]", typeof e?.name === "string" ? e.name : "UnknownError");
    res.status(500).json({ error: "Unexpected server error. Nothing was filed or submitted.", code: "INTERNAL" });
  });
  return app;
}
