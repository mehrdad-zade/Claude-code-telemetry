import dayjs from "dayjs";
import type { NormalizedEvent, ToolCallEvent, ToolResultEvent } from "@agent-tel/shared";
import { ToolCallBlock } from "./ToolCallBlock.js";
import { DiffView } from "./DiffView.js";
import { Markdown } from "./Markdown.js";

/** Builds a toolUseId -> result lookup across a whole agent's event history,
 * so a tool_call can be paired with its result regardless of which turn
 * split put them in (in practice always the same turn, but this stays
 * correct even if that ever isn't true). */
export function pairToolResults(events: NormalizedEvent[]): Map<string, ToolResultEvent> {
  const results = new Map<string, ToolResultEvent>();
  for (const e of events) if (e.kind === "tool_result") results.set(e.toolUseId, e);
  return results;
}

function formatTime(timestamp: string): string {
  return timestamp ? dayjs(timestamp).format("h:mm:ss A") : "";
}

/** Renders one event in the log. Thinking and the agent's in-between
 * narration normally arrive grouped as a ReasoningBlock (see TurnCard); the
 * cases here only cover them when rendered on their own. */
export function renderEvent(event: NormalizedEvent, results: Map<string, ToolResultEvent>) {
  const time = formatTime(event.timestamp);
  switch (event.kind) {
    case "thinking":
      return event.text ? (
        <div className="event-block reasoning-block">
          <div className="event-label">
            <span>💭 reasoning</span>
            <span className="event-time">{time}</span>
          </div>
          <Markdown text={event.text} />
        </div>
      ) : null;
    case "text":
      return (
        <div className={`event-block text-block${event.isHumanPrompt ? " human-prompt" : " assistant-text"}`}>
          <div className="event-label">
            <span>
              {event.isHumanPrompt ? "👤 user" : "🤖 assistant"}
              {event.isHumanPrompt && event.permissionMode === "plan" && (
                <span className="plan-mode-tag" title="Sent in Claude Code's plan mode">📋 plan mode</span>
              )}
            </span>
            <span className="event-time">{time}</span>
          </div>
          <Markdown text={event.text} />
        </div>
      );
    case "tool_call":
      return <ToolCallBlock call={event as ToolCallEvent} result={results.get(event.toolUseId)} time={time} />;
    case "tool_result":
      return null; // shown paired with its call instead
    case "file_edit":
      return <DiffView path={event.path} diffHunks={event.diffHunks} />;
    case "agent_spawn_pending":
      return <div className="event-block spawn-pending-block">🧩 spawning sub-agent…</div>;
    case "agent_spawn":
      return (
        <div className="event-block spawn-block">
          🧩 spawned sub-agent <code>{event.childAgentId.slice(0, 8)}</code>
          {event.subagentType ? ` (${event.subagentType})` : ""}
          {event.description ? ` — ${event.description}` : ""}
        </div>
      );
    case "agent_message":
      return (
        <div className="event-block message-block">
          ✉️ sent message to <code>{event.toAgentId.slice(0, 8)}</code>: {event.preview}
        </div>
      );
    case "lifecycle":
      return <div className="event-block lifecycle-block">session {event.state}</div>;
    default:
      return null;
  }
}
