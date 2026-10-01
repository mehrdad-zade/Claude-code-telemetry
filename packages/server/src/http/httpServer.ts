import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import type { SessionRegistry } from "../registry/sessionRegistry.js";
import type { AgentTree } from "../normalize/agentTree.js";
import { sessionsRouter } from "./routes/sessions.js";
import { transcriptRouter } from "./routes/transcript.js";

const thisDir = path.dirname(fileURLToPath(import.meta.url));

/** Builds (but does not start listening on) the HTTP server. Binding happens
 * in index.ts, explicitly to 127.0.0.1 — this is a strictly local tool since
 * transcripts can contain file contents/secrets from any of the user's
 * projects, and the server makes no outbound network calls of its own. */
export function createHttpServer(registry: SessionRegistry, agentTree: AgentTree): http.Server {
  const app = express();
  app.use(express.json());

  app.use("/api", sessionsRouter(registry, agentTree));
  app.use("/api", transcriptRouter(registry));

  // In production, serve the built web frontend from the same origin/port
  // so `npm start` alone is enough (no separate Vite dev server needed).
  // Resolved relative to THIS file (packages/server/src/http/), not
  // process.cwd() — `npm run dev -w @agent-tel/server`/`npm start` run with
  // cwd set to packages/server, so a cwd-relative path silently never
  // existed and this branch never registered, no matter what was built.
  const webDist = path.resolve(thisDir, "../../../web/dist");
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  return http.createServer(app);
}
