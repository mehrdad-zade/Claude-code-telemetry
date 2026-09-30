import { useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, { Background, type Edge, type Node, type NodeTypes } from "reactflow";
import "reactflow/dist/style.css";
import type { AgentNode, NormalizedEvent } from "@agent-tel/shared";
import { AgentNodeCard, type AgentNodeCardData } from "./AgentNodeCard.js";
import { layoutWithDagre } from "./dagreLayout.js";

const nodeTypes: NodeTypes = { agent: AgentNodeCard };
const FLASH_MS = 1500;

export function AgentGraph({
  agents,
  events,
  selectedAgentId,
  onSelect,
}: {
  agents: AgentNode[];
  events: NormalizedEvent[];
  selectedAgentId: string | null;
  onSelect: (agentId: string) => void;
}) {
  const [flashedNodes, setFlashedNodes] = useState<Set<string>>(new Set());
  const [flashedEdges, setFlashedEdges] = useState<Set<string>>(new Set());
  const seenSpawnIds = useRef<Set<string>>(new Set());
  const seenMessageIds = useRef<Set<string>>(new Set());

  // Flash a node briefly the moment its agent_spawn event is first seen, and
  // an edge briefly when a fresh agent_message fires along it.
  useEffect(() => {
    for (const event of events) {
      if (event.kind === "agent_spawn" && !seenSpawnIds.current.has(event.id)) {
        seenSpawnIds.current.add(event.id);
        flash(setFlashedNodes, event.childAgentId);
      }
      if (event.kind === "agent_message" && !seenMessageIds.current.has(event.id)) {
        seenMessageIds.current.add(event.id);
        flash(setFlashedEdges, `msg-${event.fromAgentId}-${event.toAgentId}`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node<AgentNodeCardData>[] = agents.map((agent) => ({
      id: agent.agentId,
      type: "agent",
      position: { x: 0, y: 0 },
      data: {
        agent,
        selected: agent.agentId === selectedAgentId,
        justSpawned: flashedNodes.has(agent.agentId),
        onSelect,
      },
    }));

    const spawnEdges: Edge[] = agents
      .filter((a): a is AgentNode & { parentAgentId: string } => !!a.parentAgentId)
      .map((a) => ({
        id: `spawn-${a.agentId}`,
        source: a.parentAgentId,
        target: a.agentId,
        type: "smoothstep",
      }));

    const messagePairs = new Map<string, { from: string; to: string; preview: string }>();
    for (const event of events) {
      if (event.kind !== "agent_message") continue;
      messagePairs.set(`${event.fromAgentId}->${event.toAgentId}`, {
        from: event.fromAgentId,
        to: event.toAgentId,
        preview: event.preview,
      });
    }
    const messageEdges: Edge[] = [...messagePairs.entries()].map(([key, m]) => {
      const flashKey = `msg-${m.from}-${m.to}`;
      return {
        id: `msg-${key}`,
        source: m.from,
        target: m.to,
        type: "straight",
        animated: flashedEdges.has(flashKey),
        label: flashedEdges.has(flashKey) ? m.preview.slice(0, 40) : undefined,
        style: { stroke: "var(--edge-message)", strokeDasharray: "4 3" },
      };
    });

    const laidOut = layoutWithDagre(nodes, spawnEdges);
    return { nodes: laidOut, edges: [...spawnEdges, ...messageEdges] };
  }, [agents, events, selectedAgentId, flashedNodes, flashedEdges, onSelect]);

  return (
    <div className="agent-graph">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.2}>
        <Background gap={24} />
      </ReactFlow>
    </div>
  );
}

function flash(setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string): void {
  setter((prev) => new Set(prev).add(key));
  setTimeout(() => {
    setter((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, FLASH_MS);
}
