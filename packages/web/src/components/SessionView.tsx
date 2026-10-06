import { useMemo, useState } from "react";
import type { SessionData } from "../state/store.js";
import { agentLabel, assignAgentColors } from "../lib/agentColor.js";
import { buildTurnRows } from "../lib/turnGroups.js";
import { EventFeed } from "./EventFeed.js";
import { StatusBadge } from "./StatusBadge.js";
import { VisualizationRows } from "./VisualizationRows.js";

export function SessionView({
  sessionId,
  session,
  selectedAgentId,
  onSelectAgent,
}: {
  sessionId: string;
  session: SessionData;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}) {
  const agents = useMemo(() => Object.values(session.agents), [session.agents]);
  const events = session.events;

  const activeAgentId = selectedAgentId && agents.some((a) => a.agentId === selectedAgentId) ? selectedAgentId : sessionId;

  const feedEvents = useMemo(() => events.filter((e) => e.agentId === activeAgentId), [events, activeAgentId]);

  const colors = useMemo(() => assignAgentColors(agents), [agents]);
  const activeAgent = agents.find((a) => a.agentId === activeAgentId);
  const parentAgent = activeAgent?.parentAgentId ? agents.find((a) => a.agentId === activeAgent.parentAgentId) : undefined;

  // Always built from the main agent (with every sub-agent's work folded
  // into the turn it happened in), so the Visualization shows the whole
  // session regardless of which agent's log is open below.
  const turnRows = useMemo(() => buildTurnRows(events, sessionId, agents), [events, sessionId, agents]);

  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);

  function openEvent(agentId: string, eventId: string) {
    if (agentId !== activeAgentId) onSelectAgent(agentId);
    setFocus((prev) => ({ id: eventId, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  return (
    <div className="session-view">
      <div className="agent-context-header">
        {parentAgent && (
          <button className="back-link" onClick={() => onSelectAgent(parentAgent.agentId)}>
            ← {agentLabel(parentAgent)}
          </button>
        )}
        {activeAgent && (
          <>
            <span className="agent-color-dot" style={{ background: colors.get(activeAgent.agentId) }} />
            <span className="agent-context-name">{agentLabel(activeAgent)}</span>
            <StatusBadge status={activeAgent.status} />
          </>
        )}
        {agents.length > 1 && <span className="agent-count">{agents.length} agents in this session</span>}
      </div>

      <div className="visualization-pane">
        <div className="section-label">Visualization</div>
        <VisualizationRows rows={turnRows} agentColors={colors} onOpenEvent={openEvent} />
      </div>

      <div className="event-feed-pane">
        <div className="section-label">
          Log · {activeAgent ? agentLabel(activeAgent) : "main agent"}
        </div>
        <EventFeed events={feedEvents} focusEventId={focus?.id} focusNonce={focus?.nonce} />
      </div>
    </div>
  );
}
