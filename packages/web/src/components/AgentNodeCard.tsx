import { Handle, Position, type NodeProps } from "reactflow";
import type { AgentNode } from "@agent-tel/shared";
import { StatusBadge } from "./StatusBadge.js";
import { agentLabel } from "../lib/agentColor.js";

export interface AgentNodeCardData {
  agent: AgentNode;
  selected: boolean;
  justSpawned: boolean;
  onSelect: (agentId: string) => void;
  color: string;
}

export function AgentNodeCard({ data }: NodeProps<AgentNodeCardData>) {
  const { agent, selected, justSpawned, onSelect, color } = data;

  return (
    <div
      className={`agent-node${selected ? " selected" : ""}${justSpawned ? " just-spawned" : ""}`}
      style={{ borderLeftColor: color }}
      onClick={() => onSelect(agent.agentId)}
    >
      <Handle type="target" position={Position.Top} />
      <div className="agent-node-role">
        <span className="agent-color-dot" style={{ background: color }} />
        {agent.role === "main" ? "Session" : agent.subagentType ?? "Sub-agent"}
      </div>
      <div className="agent-node-title">{agentLabel(agent)}</div>
      <StatusBadge status={agent.status} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
