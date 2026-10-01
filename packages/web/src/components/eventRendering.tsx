import type { NormalizedEvent, ToolCallEvent, ToolResultEvent } from "@agent-tel/shared";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolCallBlock } from "./ToolCallBlock.js";
import { DiffView } from "./DiffView.js";

/** Builds a toolUseId -> result lookup across a whole agent's event history,
 * so a tool_call can be paired with its result regardless of which turn
 * split put them in (in practice always the same turn, but this stays
 * correct even if that ever isn't true). */
export function pairToolResults(events: NormalizedEvent[]): Map<string, ToolResultEvent> {
  const results = new Map<string, ToolResultEvent>();
  for (const e of events) if (e.kind === "tool_result") results.set(e.toolUseId, e);
  return results;
}

export function renderEvent(event: NormalizedEvent, results: Map<string, ToolResultEvent>) {
  switch (event.kind) {
    case "thinking":
      return <ThinkingBlock text={event.text} />;
    case "text":
      return (
        <div className={`event-block text-block${event.isHumanPrompt ? " human-prompt" : ""}`}>
          <div className="event-label">{event.isHumanPrompt ? "user" : "assistant"}</div>
          <div className="text-content">{event.text}</div>
        </div>
      );
    case "tool_call":
      return <ToolCallBlock call={event as ToolCallEvent} result={results.get(event.toolUseId)} />;
    case "tool_result":
      return null; // shown paired with its call instead
    case "file_edit":
      return <DiffView path={event.path} diffHunks={event.diffHunks} />;
    case "agent_spawn_pending":
      return <div className="event-block spawn-pending-block">spawning sub-agent…</div>;
    case "agent_spawn":
      return (
        <div className="event-block spawn-block">
          spawned sub-agent <code>{event.childAgentId.slice(0, 8)}</code>
          {event.subagentType ? ` (${event.subagentType})` : ""}
          {event.description ? ` — ${event.description}` : ""}
        </div>
      );
    case "agent_message":
      return (
        <div className="event-block message-block">
          → sent message to <code>{event.toAgentId.slice(0, 8)}</code>: {event.preview}
        </div>
      );
    case "lifecycle":
      return <div className="event-block lifecycle-block">session {event.state}</div>;
    default:
      return null;
  }
}
