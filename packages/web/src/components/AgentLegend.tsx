import type { AgentNode } from "@agent-tel/shared";
import { agentLabel } from "../lib/agentColor.js";
import { StatusBadge } from "./StatusBadge.js";

/** A row of colored chips, one per known agent, so it's obvious at a glance
 * how many agents are involved and which one you're currently looking at —
 * the same color also appears on that agent's graph node and as an accent
 * on every event block in its feed. */
export function AgentLegend({
  agents,
  activeAgentId,
  onSelect,
  colors,
}: {
  agents: AgentNode[];
  activeAgentId: string;
  onSelect: (agentId: string) => void;
  colors: Map<string, string>;
}) {
  if (agents.length <= 1) return null;

  const sorted = [...agents].sort((a, b) => (a.role === "main" ? -1 : b.role === "main" ? 1 : 0));

  return (
    <div className="agent-legend">
      <span className="agent-legend-label">{agents.length} agents:</span>
      {sorted.map((agent) => {
        const color = colors.get(agent.agentId) ?? "var(--border)";
        return (
          <button
            key={agent.agentId}
            className={`agent-chip${agent.agentId === activeAgentId ? " active" : ""}`}
            style={{ borderColor: color }}
            onClick={() => onSelect(agent.agentId)}
          >
            <span className="agent-color-dot" style={{ background: color }} />
            {agentLabel(agent)}
            <StatusBadge status={agent.status} />
          </button>
        );
      })}
    </div>
  );
}
