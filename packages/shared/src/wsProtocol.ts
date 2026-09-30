import type { AgentNode, LiveSession, NormalizedEvent } from "./events.js";

export type ServerToClientMessage =
  | { type: "roster"; sessions: LiveSession[] }
  | { type: "snapshot"; sessionId: string; agents: AgentNode[]; events: NormalizedEvent[] }
  | { type: "agent_upsert"; agent: AgentNode }
  | { type: "event"; event: NormalizedEvent }
  | { type: "session_ended"; sessionId: string };

export type ClientToServerMessage =
  | { type: "subscribe"; sessionId: string }
  | { type: "unsubscribe"; sessionId: string };
