import { Router } from "express";
import type { SessionRegistry } from "../../registry/sessionRegistry.js";
import type { AgentTree } from "../../normalize/agentTree.js";
import { listProjectHistory } from "../../history/projectScanner.js";

export function sessionsRouter(registry: SessionRegistry, agentTree: AgentTree): Router {
  const router = Router();

  router.get("/sessions", (_req, res) => {
    res.json(registry.list());
  });

  router.get("/sessions/:sessionId/tree", (req, res) => {
    res.json(agentTree.getTree(req.params.sessionId));
  });

  router.get("/projects", async (_req, res) => {
    const liveIds = new Set(registry.list().map((s) => s.sessionId));
    const entries = await listProjectHistory(liveIds);
    res.json(entries);
  });

  return router;
}
