import { create } from "zustand";
import type {
  AgentNode,
  LiveSession,
  NormalizedEvent,
  ProjectHistoryEntry,
  ServerToClientMessage,
} from "@agent-tel/shared";

const MAX_EVENTS_PER_SESSION = 3000;

export interface SessionData {
  mode: "live" | "replay";
  ended: boolean;
  agents: Record<string, AgentNode>;
  /** Chronological (by seq/timestamp as received). */
  events: NormalizedEvent[];
  /** Only meaningful in replay mode: index into `events` up to which the UI
   * should render, driven by ReplayControls. */
  replayCursor: number;
  replayPlaying: boolean;
}

function emptySession(mode: SessionData["mode"]): SessionData {
  return { mode, ended: false, agents: {}, events: [], replayCursor: 0, replayPlaying: false };
}

interface StoreState {
  roster: LiveSession[];
  projects: ProjectHistoryEntry[];
  sessions: Record<string, SessionData>;
  selectedSessionId: string | null;
  selectedAgentId: string | null;

  setRoster: (sessions: LiveSession[]) => void;
  setProjects: (entries: ProjectHistoryEntry[]) => void;
  applyServerMessage: (msg: ServerToClientMessage) => void;
  loadReplay: (sessionId: string, agents: AgentNode[], events: NormalizedEvent[]) => void;
  selectSession: (sessionId: string | null) => void;
  selectAgent: (agentId: string | null) => void;
  setReplayCursor: (sessionId: string, cursor: number) => void;
  setReplayPlaying: (sessionId: string, playing: boolean) => void;
}

export const useStore = create<StoreState>((set, get) => ({
  roster: [],
  projects: [],
  sessions: {},
  selectedSessionId: null,
  selectedAgentId: null,

  setRoster: (roster) => set({ roster }),
  setProjects: (projects) => set({ projects }),

  selectSession: (sessionId) => set({ selectedSessionId: sessionId, selectedAgentId: sessionId }),
  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

  loadReplay: (sessionId, agents, events) => {
    const agentMap: Record<string, AgentNode> = {};
    for (const a of agents) agentMap[a.agentId] = a;
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          mode: "replay",
          ended: true,
          agents: agentMap,
          events,
          replayCursor: events.length,
          replayPlaying: false,
        },
      },
    }));
  },

  setReplayCursor: (sessionId, cursor) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...session, replayCursor: cursor } } };
    }),

  setReplayPlaying: (sessionId, playing) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...session, replayPlaying: playing } } };
    }),

  applyServerMessage: (msg) => {
    switch (msg.type) {
      case "roster":
        set({ roster: msg.sessions });
        return;

      case "snapshot": {
        const agentMap: Record<string, AgentNode> = {};
        for (const a of msg.agents) agentMap[a.agentId] = a;
        set((state) => {
          const existing = state.sessions[msg.sessionId];
          return {
            sessions: {
              ...state.sessions,
              [msg.sessionId]: {
                mode: "live",
                ended: existing?.ended ?? false,
                agents: agentMap,
                events: msg.events,
                replayCursor: msg.events.length,
                replayPlaying: false,
              },
            },
          };
        });
        return;
      }

      case "agent_upsert": {
        const agent = msg.agent;
        set((state) => {
          const session = state.sessions[agent.sessionId] ?? emptySession("live");
          return {
            sessions: {
              ...state.sessions,
              [agent.sessionId]: {
                ...session,
                agents: { ...session.agents, [agent.agentId]: agent },
              },
            },
          };
        });
        return;
      }

      case "event": {
        const event = msg.event;
        set((state) => {
          const session = state.sessions[event.sessionId] ?? emptySession("live");
          const events = [...session.events, event];
          if (events.length > MAX_EVENTS_PER_SESSION) events.splice(0, events.length - MAX_EVENTS_PER_SESSION);
          return {
            sessions: {
              ...state.sessions,
              [event.sessionId]: { ...session, events, replayCursor: events.length },
            },
          };
        });
        return;
      }

      case "session_ended": {
        set((state) => {
          const session = state.sessions[msg.sessionId];
          if (!session) return state;
          return {
            sessions: { ...state.sessions, [msg.sessionId]: { ...session, ended: true } },
          };
        });
        return;
      }
    }
  },
}));

export function getSession(sessionId: string | null): SessionData | undefined {
  if (!sessionId) return undefined;
  return useStore.getState().sessions[sessionId];
}
