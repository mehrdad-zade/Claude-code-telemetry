import { Handle, Position, type NodeProps } from "reactflow";
import type { AgentNode } from "@agent-tel/shared";
import { StatusBadge } from "./StatusBadge.js";

export interface AgentNodeCardData {
  agent: AgentNode;
  selected: boolean;
  justSpawned: boolean;
  onSelect: (agentId: string) => void;
}

export function AgentNodeCard({ data }: NodeProps<AgentNodeCardData>) {
  const { agent, selected, justSpawned, onSelect } = data;

  return (
    <div
      className={`agent-node${selected ? " selected" : ""}${justSpawned ? " just-spawned" : ""}`}
      onClick={() => onSelect(agent.agentId)}
    >
      <Handle type="target" position={Position.Top} />
      <div className="agent-node-role">{agent.role === "main" ? "Session" : agent.subagentType ?? "Sub-agent"}</div>
      <div className="agent-node-title">{agent.title ?? agent.description ?? agent.agentId.slice(0, 10)}</div>
      <StatusBadge status={agent.status} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
