import { useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, { Background, type Edge, type Node, type NodeTypes } from "reactflow";
import "reactflow/dist/style.css";
import type { AgentNode, NormalizedEvent } from "@agent-tel/shared";
import { summarizeAgentEvents } from "../lib/agentStats.js";
import { AgentNodeCard, type AgentNodeCardData } from "./AgentNodeCard.js";
import { layoutWithDagre } from "./dagreLayout.js";

const nodeTypes: NodeTypes = { agent: AgentNodeCard };
const FLASH_MS = 1500;

export function AgentGraph({
  agents,
  events,
  selectedAgentId,
  onSelect,
  colors,
}: {
  agents: AgentNode[];
  events: NormalizedEvent[];
  selectedAgentId: string | null;
  onSelect: (agentId: string) => void;
  colors: Map<string, string>;
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

  const eventsByAgent = useMemo(() => {
    const map = new Map<string, NormalizedEvent[]>();
    for (const event of events) {
      let list = map.get(event.agentId);
      if (!list) {
        list = [];
        map.set(event.agentId, list);
      }
      list.push(event);
    }
    return map;
  }, [events]);

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
        color: colors.get(agent.agentId) ?? "var(--border)",
        stats: summarizeAgentEvents(eventsByAgent.get(agent.agentId) ?? []),
      },
    }));

    const agentById = new Map(agents.map((a) => [a.agentId, a]));
    const spawnEdges: Edge[] = agents
      .filter((a): a is AgentNode & { parentAgentId: string } => !!a.parentAgentId)
      .map((a) => {
        const justSpawned = flashedNodes.has(a.agentId);
        const label = a.subagentType ?? a.description ? `🧩 ${a.subagentType ?? ""}${a.description ? ` · ${truncate(a.description, 36)}` : ""}` : "🧩 spawned";
        return {
          id: `spawn-${a.agentId}`,
          source: a.parentAgentId,
          target: a.agentId,
          type: "smoothstep",
          label,
          labelBgPadding: [6, 3] as [number, number],
          labelBgStyle: { fill: "var(--panel-bg)", fillOpacity: 0.9 },
          labelStyle: { fill: "var(--text-dim)", fontSize: 11 },
          style: { stroke: justSpawned ? "var(--status-done)" : "var(--edge-spawn)", strokeWidth: justSpawned ? 2.5 : 1.5 },
        };
      });

    // Keep every agent_message pair as a persistent edge labeled with the
    // most recent handoff's preview — this is the "what was done" the
    // handoff ask needs, not just a flash that disappears.
    const messagePairs = new Map<string, { from: string; to: string; preview: string; count: number }>();
    for (const event of events) {
      if (event.kind !== "agent_message") continue;
      const key = `${event.fromAgentId}->${event.toAgentId}`;
      const existing = messagePairs.get(key);
      messagePairs.set(key, { from: event.fromAgentId, to: event.toAgentId, preview: event.preview, count: (existing?.count ?? 0) + 1 });
    }
    const messageEdges: Edge[] = [...messagePairs.entries()]
      .filter(([, m]) => agentById.has(m.from) && agentById.has(m.to))
      .map(([key, m]) => {
        const flashKey = `msg-${m.from}-${m.to}`;
        const justSent = flashedEdges.has(flashKey);
        return {
          id: `msg-${key}`,
          source: m.from,
          target: m.to,
          type: "straight",
          animated: justSent,
          label: `✉️ ${truncate(m.preview, 42)}${m.count > 1 ? ` (+${m.count - 1} more)` : ""}`,
          labelBgPadding: [6, 3] as [number, number],
          labelBgStyle: { fill: "var(--panel-bg)", fillOpacity: 0.9 },
          labelStyle: { fill: "var(--edge-message)", fontSize: 11, fontWeight: justSent ? 700 : 400 },
          style: { stroke: "var(--edge-message)", strokeWidth: justSent ? 2.5 : 1.5, strokeDasharray: "4 3" },
        };
      });

    const laidOut = layoutWithDagre(nodes, spawnEdges);
    return { nodes: laidOut, edges: [...spawnEdges, ...messageEdges] };
  }, [agents, events, eventsByAgent, selectedAgentId, flashedNodes, flashedEdges, onSelect, colors]);

  return (
    <div className="agent-graph">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.2}>
        <Background gap={24} />
      </ReactFlow>
    </div>
  );
}

function truncate(text: string, max: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max)}…` : singleLine;
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
