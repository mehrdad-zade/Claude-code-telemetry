import { useMemo, useState } from "react";
import {
  VOTER_LABELS,
  VOTER_SIGNALS,
  VOTER_WEIGHTS,
  summarizeSession,
  type SessionValidation,
  type Verdict,
  type VoterName,
} from "@agent-tel/shared";
import { InfoPopover } from "./InfoPopover.js";
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

  const sessionValidation = useMemo(() => summarizeSession(turnRows.map((r) => r.validation)), [turnRows]);

  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);

  const [logMinimized, setLogMinimized] = useState(() => readLogMinimized());
  function setLogMin(value: boolean) {
    setLogMinimized(value);
    try {
      localStorage.setItem(LOG_MINIMIZED_KEY, value ? "1" : "0");
    } catch {
      // storage unavailable (private mode etc.) — the toggle still works for this page
    }
  }

  function openEvent(agentId: string, eventId: string) {
    // Jumping to an event needs the log on screen.
    if (logMinimized) setLogMin(false);
    if (agentId !== activeAgentId) onSelectAgent(agentId);
    setFocus((prev) => ({ id: eventId, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  return (
    <div className={`session-view${logMinimized ? " log-minimized" : ""}`}>
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
        <div className="section-label section-label-row">
          <span>Visualization</span>
          {sessionValidation.requirementCount > 0 && (
            <span className="session-validation">
              <span className={`session-validation-score viz-verdict-${verdictOf(sessionValidation.accuracy)}`}>
                Final validation {sessionValidation.accuracy}%
              </span>
              <span className="session-validation-meta">
                90% CI {sessionValidation.interval[0]}–{sessionValidation.interval[1]} · {sessionValidation.met} met /{" "}
                {sessionValidation.partial} partial / {sessionValidation.unmet} unmet
                {sessionValidation.superseded > 0 && ` · ${sessionValidation.superseded} redone`} ·{" "}
                <span className={`viz-confidence-${sessionValidation.confidenceLevel}`}>confidence {sessionValidation.confidenceLevel}</span>
              </span>
              <InfoPopover label="How the final validation is scored">
                <FinalValidationDetails summary={sessionValidation} />
                <VoterTable />
              </InfoPopover>
            </span>
          )}
        </div>
        <VisualizationRows rows={turnRows} agentColors={colors} onOpenEvent={openEvent} />
      </div>

      <div className="event-feed-pane">
        <div className="section-label section-label-row log-header">
          <span>Log · {activeAgent ? agentLabel(activeAgent) : "main agent"}</span>
          <button
            className="log-toggle"
            onClick={() => setLogMin(!logMinimized)}
            title={logMinimized ? "Restore the log" : "Minimize the log to the bottom for a bigger Visualization"}
            aria-label={logMinimized ? "Restore log" : "Minimize log"}
            aria-expanded={!logMinimized}
          >
            {logMinimized ? "▴" : "▾"}
          </button>
        </div>
        {/* Kept mounted while minimized so scroll position and expanded turns survive. */}
        <div className="event-feed-body" hidden={logMinimized}>
          <EventFeed events={feedEvents} focusEventId={focus?.id} focusNonce={focus?.nonce} />
        </div>
      </div>
    </div>
  );
}

const LOG_MINIMIZED_KEY = "agent-tel:log-minimized";

function readLogMinimized(): boolean {
  try {
    return localStorage.getItem(LOG_MINIMIZED_KEY) === "1";
  } catch {
    return false;
  }
}

function verdictOf(accuracy: number): Verdict {
  return accuracy >= 70 ? "met" : accuracy >= 40 ? "partial" : "unmet";
}

/** How the headline number was reached: latest attempt per requirement. */
function FinalValidationDetails({ summary }: { summary: SessionValidation }) {
  return (
    <div className="validation-details final-validation-details">
      <div className="info-popover-title">Final validation · {summary.accuracy}%</div>
      <div className="info-popover-note">
        The session's end state. Every requirement from every scored turn (and approved plan) is taken in order; when a later turn re-addresses
        an earlier requirement — a correction, a fix, or a repeat — only the latest attempt counts. A bug you reported and the agent then fixed
        ends as met.
      </div>
      <table className="validation-table final-stats">
        <tbody>
          <tr>
            <td>Final validation</td>
            <td>{summary.accuracy}%</td>
          </tr>
          <tr>
            <td>90% confidence interval (share met)</td>
            <td>
              {summary.interval[0]}–{summary.interval[1]}%
            </td>
          </tr>
          <tr>
            <td>Requirements in the final tally</td>
            <td>
              {summary.requirementCount} · ✅ {summary.met} · 🟡 {summary.partial} · ❌ {summary.unmet}
            </td>
          </tr>
          <tr>
            <td>Earlier attempts superseded by a later turn</td>
            <td>{summary.superseded}</td>
          </tr>
          <tr>
            <td>First-pass accuracy (every attempt as first scored)</td>
            <td>{summary.firstPassAccuracy}%</td>
          </tr>
          <tr>
            <td>Turns scored</td>
            <td>{summary.turnsScored}</td>
          </tr>
          <tr>
            <td>Vote confidence</td>
            <td>
              {summary.confidenceLevel} ({Math.round(summary.confidence * 100)}%)
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** The scoring model behind every validation number: each voter, what it
 * looks at, and how much say it gets. */
function VoterTable() {
  const voters = Object.keys(VOTER_WEIGHTS) as VoterName[];
  return (
    <div className="validation-details">
      <div className="info-popover-title">How validation is scored</div>
      <div className="info-popover-note">
        A local heuristic, no model calls. Each instruction (and an approved plan's steps) is split into requirements. Every voter rates
        each requirement 0–100 or abstains. The score is the weighted mean of the votes cast; confidence is how much the voters agree × how
        many had evidence.
      </div>
      <table className="validation-table voter-table">
        <thead>
          <tr>
            <th>Voter</th>
            <th>Signal</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody>
          {voters.map((v) => (
            <tr key={v}>
              <td className="voter-name">{VOTER_LABELS[v]}</td>
              <td className="voter-signal">{VOTER_SIGNALS[v]}</td>
              <td>{VOTER_WEIGHTS[v].toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="info-popover-note">
        ✅ met ≥ 70 · 🟡 partial ≥ 40 · ❌ unmet below. The session range is a 90% Wilson interval on the share of requirements met
        (partial counts half).
      </div>
    </div>
  );
}
