import type { AgentNode } from "@agent-tel/shared";

// A small, fixed palette of distinct accent colors used to tell agents apart
// at a glance (graph nodes, the agent legend, event-feed accents). Indigo is
// deliberately excluded — it's reserved for the "selected" ring/accent
// elsewhere in the UI, so an agent's own color never gets confused with a
// selection highlight.
const PALETTE = [
  "#06b6d4", // cyan
  "#f59e0b", // amber
  "#22c55e", // green
  "#a855f7", // purple
  "#ec4899", // pink
  "#ef4444", // red
  "#14b8a6", // teal
  "#eab308", // yellow
];

/** Assigns each agent a color by position (main session first, then
 * sub-agents in spawn order) rather than hashing its id — a hash can (and,
 * with only a couple of agents, often does) collide, which defeats the
 * entire point of color-coding. Position-based assignment guarantees every
 * agent in a session gets a distinct color as long as there are no more than
 * `PALETTE.length` of them, and stays stable as more agents are added since
 * existing agents keep their index. */
export function assignAgentColors(agents: AgentNode[]): Map<string, string> {
  const ordered = [...agents].sort((a, b) => {
    if (a.role !== b.role) return a.role === "main" ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const map = new Map<string, string>();
  ordered.forEach((agent, i) => map.set(agent.agentId, PALETTE[i % PALETTE.length]));
  return map;
}

interface AgentLike {
  agentId: string;
  role: "main" | "subagent";
  title?: string;
  description?: string;
  subagentType?: string;
}

/** The short human-readable label used everywhere an agent needs naming:
 * the graph node, the legend chips, the feed header. */
export function agentLabel(agent: AgentLike): string {
  return agent.title ?? agent.description ?? agent.subagentType ?? `${agent.role} ${agent.agentId.slice(0, 8)}`;
}
