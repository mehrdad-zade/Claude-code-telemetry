import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type {
  AgentNode,
  ClientToServerMessage,
  LiveSession,
  NormalizedEvent,
  ServerToClientMessage,
} from "@agent-tel/shared";
import { logger } from "../logger.js";
import type { AgentTree } from "../normalize/agentTree.js";
import type { HistoryStore } from "../history/historyStore.js";

interface ClientState {
  ws: WebSocket;
  subscriptions: Set<string>;
}

/** Fans out normalized events to subscribed browser clients over a single
 * WebSocket endpoint on the same HTTP server/port as the REST API. A client
 * subscribes per top-level session and receives everything under that
 * session's whole agent tree (main + all descendant sub-agents), tagged by
 * agentId so the frontend can route each event to the right graph node. */
export class WsServer {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<ClientState>();

  constructor(
    httpServer: HttpServer,
    private readonly agentTree: AgentTree,
    private readonly historyStore: HistoryStore,
    private readonly getRoster: () => LiveSession[]
  ) {
    this.wss = new WebSocketServer({ server: httpServer, path: "/ws" });
    this.wss.on("connection", (ws) => this.handleConnection(ws));
  }

  broadcastRoster(sessions: LiveSession[]): void {
    for (const client of this.clients) this.send(client.ws, { type: "roster", sessions });
  }

  broadcastSessionEnded(sessionId: string): void {
    for (const client of this.clients) {
      if (client.subscriptions.has(sessionId)) this.send(client.ws, { type: "session_ended", sessionId });
    }
  }

  broadcastAgentUpsert(agent: AgentNode): void {
    for (const client of this.clients) {
      if (client.subscriptions.has(agent.sessionId)) this.send(client.ws, { type: "agent_upsert", agent });
    }
  }

  broadcastEvent(event: NormalizedEvent): void {
    for (const client of this.clients) {
      if (client.subscriptions.has(event.sessionId)) this.send(client.ws, { type: "event", event });
    }
  }

  private handleConnection(ws: WebSocket): void {
    const state: ClientState = { ws, subscriptions: new Set() };
    this.clients.add(state);

    this.send(ws, { type: "roster", sessions: this.getRoster() });

    ws.on("message", (raw) => {
      let msg: ClientToServerMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "subscribe") {
        state.subscriptions.add(msg.sessionId);
        this.send(ws, {
          type: "snapshot",
          sessionId: msg.sessionId,
          agents: this.agentTree.getTree(msg.sessionId),
          events: this.historyStore.recentForSession(msg.sessionId),
        });
      } else if (msg.type === "unsubscribe") {
        state.subscriptions.delete(msg.sessionId);
      }
    });

    ws.on("close", () => this.clients.delete(state));
    ws.on("error", (err) => logger.error("ws client error", err));
  }

  private send(ws: WebSocket, msg: ServerToClientMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}
