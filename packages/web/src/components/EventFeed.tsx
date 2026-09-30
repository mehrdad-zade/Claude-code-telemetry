import { Fragment, useEffect, useMemo, useRef } from "react";
import type { NormalizedEvent, ToolCallEvent, ToolResultEvent } from "@agent-tel/shared";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolCallBlock } from "./ToolCallBlock.js";
import { DiffView } from "./DiffView.js";

interface Row {
  event: NormalizedEvent;
  pairedResult?: ToolResultEvent;
}

function buildRows(events: NormalizedEvent[]): { rows: Row[]; otherCount: number } {
  const results = new Map<string, ToolResultEvent>();
  for (const e of events) if (e.kind === "tool_result") results.set(e.toolUseId, e);

  const rows: Row[] = [];
  let otherCount = 0;

  for (const event of events) {
    if (event.kind === "tool_result") continue; // shown paired with its call instead
    if (event.kind === "raw" && event.rawType.startsWith("system:")) continue;
    if (event.kind === "raw") {
      otherCount++;
      continue;
    }
    if (event.kind === "tool_call") {
      rows.push({ event, pairedResult: results.get(event.toolUseId) });
    } else {
      rows.push({ event });
    }
  }
  return { rows, otherCount };
}

export function EventFeed({ events }: { events: NormalizedEvent[] }) {
  const { rows, otherCount } = useMemo(() => buildRows(events), [events]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [rows.length]);

  return (
    <div className="event-feed">
      {rows.length === 0 && <div className="empty-hint">No activity yet.</div>}
      {rows.map(({ event, pairedResult }) => (
        <Fragment key={event.id}>{renderEvent(event, pairedResult)}</Fragment>
      ))}
      {otherCount > 0 && <div className="other-events-hint">{otherCount} other background event(s) hidden</div>}
      <div ref={bottomRef} />
    </div>
  );
}

function renderEvent(event: NormalizedEvent, pairedResult?: ToolResultEvent) {
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
      return <ToolCallBlock call={event as ToolCallEvent} result={pairedResult} />;
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
