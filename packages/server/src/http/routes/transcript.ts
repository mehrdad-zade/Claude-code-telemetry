import path from "node:path";
import { Router } from "express";
import { config, projectDirFor } from "../../config.js";
import type { SessionRegistry } from "../../registry/sessionRegistry.js";
import { buildSessionReplay } from "../../history/historyReplay.js";
import { SessionStatsCache } from "../../history/sessionStats.js";
import { logger } from "../../logger.js";

export function transcriptRouter(registry: SessionRegistry): Router {
  const router = Router();

  router.get("/sessions/:sessionId/history", async (req, res) => {
    const { sessionId } = req.params;

    const live = registry.list().find((s) => s.sessionId === sessionId);
    const encodedCwd = typeof req.query.encodedCwd === "string" ? req.query.encodedCwd : null;

    const projectDir = live ? projectDirFor(live.cwd) : encodedCwd ? path.join(config.projectsDir, encodedCwd) : null;

    if (!projectDir) {
      res.status(400).json({ error: "unknown session — pass ?encodedCwd=<dir> from /api/projects" });
      return;
    }

    try {
      const replay = await buildSessionReplay(projectDir, sessionId);
      res.json(replay);
    } catch (err) {
      logger.error("history replay failed", sessionId, err);
      res.status(500).json({ error: "failed to build session history" });
    }
  });

  const stats = new SessionStatsCache();

  // Final validation + total tokens for one session, for the sidebar.
  router.get("/sessions/:sessionId/stats", async (req, res) => {
    const { sessionId } = req.params;
    const live = registry.list().find((s) => s.sessionId === sessionId);
    const encodedCwd = typeof req.query.encodedCwd === "string" ? req.query.encodedCwd : null;
    const projectDir = live ? projectDirFor(live.cwd) : encodedCwd ? path.join(config.projectsDir, encodedCwd) : null;
    if (!projectDir) {
      res.status(400).json({ error: "unknown session — pass ?encodedCwd=<dir> from /api/projects" });
      return;
    }
    try {
      res.json(await stats.get(projectDir, sessionId));
    } catch (err) {
      logger.error("session stats failed", sessionId, err);
      res.status(500).json({ error: "failed to compute session stats" });
    }
  });

  return router;
}
