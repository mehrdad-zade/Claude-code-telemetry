import { useMemo } from "react";
import type { AgentNode, NormalizedEvent } from "@agent-tel/shared";
import type { SessionData } from "../state/store.js";
import { assignAgentColors } from "../lib/agentColor.js";
import { summarizeAgentEvents } from "../lib/agentStats.js";
import { AgentDetailPanel } from "./AgentDetailPanel.js";
import { AgentGraph } from "./AgentGraph.js";
import { AgentLegend } from "./AgentLegend.js";
import { EventFeed } from "./EventFeed.js";
import { ReplayControls } from "./ReplayControls.js";

function visibleAgents(allAgents: AgentNode[], events: NormalizedEvent[]): AgentNode[] {
  const appeared = new Set(allAgents.filter((a) => a.role === "main").map((a) => a.agentId));
  for (const event of events) {
    if (event.kind === "agent_spawn") appeared.add(event.childAgentId);
  }
  return allAgents.filter((a) => appeared.has(a.agentId));
}

export function SessionView({
  sessionId,
  session,
  selectedAgentId,
  onSelectAgent,
  onReplayCursorChange,
  onReplayPlayingChange,
}: {
  sessionId: string;
  session: SessionData;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onReplayCursorChange: (cursor: number) => void;
  onReplayPlayingChange: (playing: boolean) => void;
}) {
  const allAgents = useMemo(() => Object.values(session.agents), [session.agents]);

  const effectiveEvents = useMemo(
    () => (session.mode === "replay" ? session.events.slice(0, session.replayCursor) : session.events),
    [session.mode, session.events, session.replayCursor]
  );

  // In replay mode, derive which agents had appeared by the scrub cursor so
  // scrubbing back in time hides not-yet-spawned sub-agents. In live mode,
  // just show every agent the server currently knows about — the events
  // array here is only a bounded recent-tail cache (both server ring buffer
  // and client cap), so an old agent_spawn event dropping out of that window
  // must never make an already-known, still-live agent disappear.
  const effectiveAgents = useMemo(
    () => (session.mode === "replay" ? visibleAgents(allAgents, effectiveEvents) : allAgents),
    [session.mode, allAgents, effectiveEvents]
  );

  const activeAgentId = selectedAgentId && effectiveAgents.some((a) => a.agentId === selectedAgentId)
    ? selectedAgentId
    : sessionId;

  const feedEvents = useMemo(
    () => effectiveEvents.filter((e) => e.agentId === activeAgentId),
    [effectiveEvents, activeAgentId]
  );

  // Computed once per agent set so every agent keeps a stable, DISTINCT color
  // across the graph, the legend, and the feed header — position-based
  // (not hashed) so two agents never coincidentally land on the same color.
  const colors = useMemo(() => assignAgentColors(effectiveAgents), [effectiveAgents]);
  const activeAgent = effectiveAgents.find((a) => a.agentId === activeAgentId);
  const activeStats = useMemo(() => summarizeAgentEvents(feedEvents), [feedEvents]);

  return (
    <div className="session-view">
      <div className="agent-graph-pane">
        <AgentGraph
          agents={effectiveAgents}
          events={effectiveEvents}
          selectedAgentId={activeAgentId}
          onSelect={onSelectAgent}
          colors={colors}
        />
      </div>

      {session.mode === "replay" && (
        <ReplayControls
          total={session.events.length}
          cursor={session.replayCursor}
          playing={session.replayPlaying}
          onCursorChange={onReplayCursorChange}
          onPlayingChange={onReplayPlayingChange}
        />
      )}

      <AgentLegend agents={effectiveAgents} activeAgentId={activeAgentId} onSelect={onSelectAgent} colors={colors} />

      <div className="event-feed-pane">
        {activeAgent ? (
          <AgentDetailPanel agent={activeAgent} stats={activeStats} color={colors.get(activeAgent.agentId) ?? "var(--border)"} />
        ) : (
          <div className="event-feed-header">{activeAgentId}</div>
        )}
        <EventFeed events={feedEvents} />
      </div>
    </div>
  );
}
