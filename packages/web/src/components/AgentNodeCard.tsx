import { Handle, Position, type NodeProps } from "reactflow";
import type { AgentNode } from "@agent-tel/shared";
import { StatusBadge } from "./StatusBadge.js";
import { agentLabel } from "../lib/agentColor.js";
import { STEP_COLOR, STEP_GLYPH, type AgentStats } from "../lib/agentStats.js";

export interface AgentNodeCardData {
  agent: AgentNode;
  selected: boolean;
  justSpawned: boolean;
  onSelect: (agentId: string) => void;
  color: string;
  stats: AgentStats;
}

const MAX_TOOL_BADGES = 3;

export function AgentNodeCard({ data }: NodeProps<AgentNodeCardData>) {
  const { agent, selected, justSpawned, onSelect, color, stats } = data;
  const topTools = stats.toolCounts.slice(0, MAX_TOOL_BADGES);
  const moreTools = stats.toolCounts.length - topTools.length;

  return (
    <div
      className={`agent-node${selected ? " selected" : ""}${justSpawned ? " just-spawned" : ""}`}
      style={{ borderLeftColor: color }}
      onClick={() => onSelect(agent.agentId)}
      title="Click for full detail"
    >
      <Handle type="target" position={Position.Top} />
      <div className="agent-node-role">
        <span className="agent-color-dot" style={{ background: color }} />
        {agent.role === "main" ? "Session" : agent.subagentType ?? "Sub-agent"}
      </div>
      <div className="agent-node-title">{agentLabel(agent)}</div>
      <StatusBadge status={agent.status} />

      {topTools.length > 0 && (
        <div className="agent-node-tools">
          {topTools.map((t) => (
            <span className="tool-mini-badge" key={t.name}>
              {t.name}×{t.count}
            </span>
          ))}
          {moreTools > 0 && <span className="tool-mini-badge tool-mini-badge-more">+{moreTools}</span>}
        </div>
      )}

      {stats.steps.length > 0 && (
        <div className="agent-node-sparkline" title={`${stats.totalToolCalls} tool calls · ${stats.fileEditCount} files edited`}>
          {stats.steps.map((step) => (
            <span
              key={step.id}
              className={`spark-dot${step.isError ? " spark-error" : ""}`}
              style={{ color: STEP_COLOR[step.kind] }}
              title={step.kind === "tool_call" ? step.toolName : step.kind.replace("_", " ")}
            >
              {STEP_GLYPH[step.kind]}
            </span>
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
