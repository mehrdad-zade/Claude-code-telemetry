import { EventEmitter } from "node:events";
import type { AgentNode, AgentStatus, LiveSession, NormalizedEvent } from "@agent-tel/shared";

export interface AgentTreeEvents {
  /** Fired whenever a node is created or its displayable fields change, so
   * callers can push an `agent_upsert` message to subscribed clients. */
  agentUpsert: [AgentNode];
}

function statusForEvent(event: NormalizedEvent): AgentStatus | null {
  switch (event.kind) {
    case "thinking":
      return "thinking";
    case "tool_call":
      return "tool_running";
    case "tool_result":
      return "thinking";
    case "text":
      return event.isHumanPrompt ? "thinking" : "idle";
    case "lifecycle":
      return event.state === "ended" ? "done" : null;
    case "raw":
      if (event.rawType === "system:turn_duration") return "idle";
      return null;
    default:
      return null;
  }
}

/** Maintains the in-memory hierarchy of agents (main sessions + all their
 * sub-agents, nested arbitrarily deep) and derives each node's live status
 * from the normalized event stream. Keyed globally by agentId — safe because
 * a main session's agentId (its sessionId) and a sub-agent's agentId (its
 * hex agentId) are drawn from disjoint id spaces in practice. */
export class AgentTree extends EventEmitter {
  private agents = new Map<string, AgentNode>();
  /** sessionId -> set of agentId belonging to it (main + all descendants). */
  private bySession = new Map<string, Set<string>>();

  /** Accepts a full LiveSession for a live session, or just the minimal
   * {sessionId, cwd} for a historical replay where pid/name/startedAt aren't
   * known/relevant. */
  ensureMainAgent(session: Pick<LiveSession, "sessionId" | "cwd"> & Partial<LiveSession>): AgentNode {
    const existing = this.agents.get(session.sessionId);
    if (existing) return existing;

    const node: AgentNode = {
      agentId: session.sessionId,
      parentAgentId: null,
      role: "main",
      sessionId: session.sessionId,
      cwd: session.cwd,
      spawnedByToolUseId: null,
      title: session.name,
      createdAt: session.startedAt ? new Date(session.startedAt).toISOString() : new Date().toISOString(),
      status: "unknown",
      lastActivityAt: new Date().toISOString(),
    };
    this.upsert(node);
    return node;
  }

  ensureSubagent(sessionId: string, agentId: string, cwd: string): AgentNode {
    const existing = this.agents.get(agentId);
    if (existing) return existing;

    const node: AgentNode = {
      agentId,
      parentAgentId: null,
      role: "subagent",
      sessionId,
      cwd,
      spawnedByToolUseId: null,
      createdAt: new Date().toISOString(),
      status: "unknown",
      lastActivityAt: new Date().toISOString(),
    };
    this.upsert(node);
    return node;
  }

  /** Applies one normalized event, updating node status/metadata as needed.
   * Returns the set of nodes that changed so the caller can broadcast them
   * alongside the raw event. */
  applyEvent(event: NormalizedEvent): AgentNode[] {
    const changed: AgentNode[] = [];
    const target = this.agents.get(event.agentId);
    if (target) {
      const status = statusForEvent(event);
      const next: AgentNode = {
        ...target,
        status: status ?? target.status,
        lastActivityAt: event.timestamp,
      };
      if (this.differs(target, next)) {
        this.upsert(next);
        changed.push(next);
      }
    }

    if (event.kind === "agent_spawn") {
      const parent = this.agents.get(event.parentAgentId);
      const child: AgentNode = this.agents.get(event.childAgentId) ?? {
        agentId: event.childAgentId,
        parentAgentId: event.parentAgentId,
        role: "subagent",
        sessionId: event.sessionId,
        cwd: parent?.cwd ?? "",
        spawnedByToolUseId: event.toolUseId,
        subagentType: event.subagentType,
        description: event.description,
        createdAt: event.timestamp,
        status: "thinking",
        lastActivityAt: event.timestamp,
      };
      child.parentAgentId = event.parentAgentId;
      child.spawnedByToolUseId = event.toolUseId;
      child.subagentType = event.subagentType ?? child.subagentType;
      child.description = event.description ?? child.description;
      this.upsert(child);
      changed.push(child);
    }

    return changed;
  }

  getTree(sessionId: string): AgentNode[] {
    const ids = this.bySession.get(sessionId);
    if (!ids) return [];
    return [...ids].map((id) => this.agents.get(id)).filter((n): n is AgentNode => !!n);
  }

  getAgent(agentId: string): AgentNode | undefined {
    return this.agents.get(agentId);
  }

  removeSession(sessionId: string): void {
    const ids = this.bySession.get(sessionId);
    if (!ids) return;
    for (const id of ids) this.agents.delete(id);
    this.bySession.delete(sessionId);
  }

  private differs(a: AgentNode, b: AgentNode): boolean {
    return a.status !== b.status || a.title !== b.title || a.description !== b.description;
  }

  private upsert(node: AgentNode): void {
    this.agents.set(node.agentId, node);
    let set = this.bySession.get(node.sessionId);
    if (!set) {
      set = new Set();
      this.bySession.set(node.sessionId, set);
    }
    set.add(node.agentId);
    this.emit("agentUpsert", node);
  }
}

export declare interface AgentTree {
  on<K extends keyof AgentTreeEvents>(event: K, listener: (...args: AgentTreeEvents[K]) => void): this;
  emit<K extends keyof AgentTreeEvents>(event: K, ...args: AgentTreeEvents[K]): boolean;
}
