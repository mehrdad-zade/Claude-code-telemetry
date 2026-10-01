import { Handle, Position, type NodeProps } from "reactflow";
import type { AgentNode } from "@agent-tel/shared";
import { StatusBadge } from "./StatusBadge.js";
import { agentLabel } from "../lib/agentColor.js";
import type { AgentStats } from "../lib/agentStats.js";

export interface AgentNodeCardData {
  agent: AgentNode;
  selected: boolean;
  justSpawned: boolean;
  onSelect: (agentId: string) => void;
  color: string;
  stats: AgentStats;
}

/** Deliberately minimal — this is a navigation box, not a dashboard. What
 * the agent actually did lives in the JourneyFlow timeline and the detail
 * panel once you click in; cramming tool badges/icons in here just made the
 * box noisy and non-interactive. */
export function AgentNodeCard({ data }: NodeProps<AgentNodeCardData>) {
  const { agent, selected, justSpawned, onSelect, color, stats } = data;

  return (
    <div
      className={`agent-node${selected ? " selected" : ""}${justSpawned ? " just-spawned" : ""}`}
      style={{ borderLeftColor: color }}
      onClick={() => onSelect(agent.agentId)}
      title="Click to see this agent's journey"
    >
      <Handle type="target" position={Position.Top} />
      <div className="agent-node-role">
        <span className="agent-color-dot" style={{ background: color }} />
        {agent.role === "main" ? "Session" : agent.subagentType ?? "Sub-agent"}
      </div>
      <div className="agent-node-title">{agentLabel(agent)}</div>
      <StatusBadge status={agent.status} />
      {stats.totalToolCalls > 0 && (
        <div className="agent-node-gist">
          {stats.totalToolCalls} tool call{stats.totalToolCalls === 1 ? "" : "s"}
          {stats.fileEditCount > 0 ? ` · ${stats.fileEditCount} edited` : ""}
          {stats.spawnCount > 0 ? ` · ${stats.spawnCount} spawned` : ""}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
