import { config } from "./config.js";
import { logger } from "./logger.js";
import { SessionRegistry } from "./registry/sessionRegistry.js";
import { AgentTree } from "./normalize/agentTree.js";
import { HistoryStore } from "./history/historyStore.js";
import { TranscriptWatcher } from "./transcripts/transcriptWatcher.js";
import { createHttpServer } from "./http/httpServer.js";
import { WsServer } from "./ws/wsServer.js";

const registry = new SessionRegistry();
const agentTree = new AgentTree();
const historyStore = new HistoryStore();
const watchers = new Map<string, TranscriptWatcher>();

const httpServer = createHttpServer(registry, agentTree);
const wsServer = new WsServer(httpServer, agentTree, historyStore, () => registry.list());

agentTree.on("agentUpsert", (agent) => wsServer.broadcastAgentUpsert(agent));

registry.on("sessionAdded", (session) => {
  logger.info("session live:", session.sessionId, session.cwd);
  const watcher = new TranscriptWatcher(session, agentTree, historyStore, (event) => {
    wsServer.broadcastEvent(event);
  });
  watchers.set(session.sessionId, watcher);
  watcher.start();
  wsServer.broadcastRoster(registry.list());
});

registry.on("sessionUpdated", () => {
  wsServer.broadcastRoster(registry.list());
});

registry.on("sessionRemoved", (session) => {
  logger.info("session ended:", session.sessionId);
  const watcher = watchers.get(session.sessionId);
  watcher?.stop();
  watchers.delete(session.sessionId);

  wsServer.broadcastRoster(registry.list());
  wsServer.broadcastSessionEnded(session.sessionId);

  setTimeout(() => {
    historyStore.evictSession(session.sessionId);
    agentTree.removeSession(session.sessionId);
  }, config.endedSessionGraceMs);
});

registry.start();

httpServer.listen(config.port, config.host, () => {
  logger.info(`listening on http://${config.host}:${config.port} (localhost only)`);
});

function shutdown(): void {
  logger.info("shutting down...");
  registry.stop();
  for (const watcher of watchers.values()) watcher.stop();
  httpServer.close(() => process.exit(0));
  // Force-exit if something keeps the event loop alive.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
