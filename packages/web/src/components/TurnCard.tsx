import { Fragment, useMemo } from "react";
import dayjs from "dayjs";
import type { NormalizedEvent, ToolResultEvent } from "@agent-tel/shared";
import type { Turn } from "../lib/turns.js";
import { summarizeTurn } from "../lib/turns.js";
import { renderEvent } from "./eventRendering.js";

export function TurnCard({
  turn,
  index,
  expanded,
  onToggle,
  results,
  live,
}: {
  turn: Turn;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  results: Map<string, ToolResultEvent>;
  live: boolean;
}) {
  const summary = useMemo(() => summarizeTurn(turn.events), [turn.events]);
  const visibleEvents = useMemo(
    () => turn.events.filter((e: NormalizedEvent) => !(e.kind === "raw" && e.rawType.startsWith("system:"))),
    [turn.events]
  );
  const otherCount = turn.events.length - visibleEvents.filter((e) => e.kind !== "tool_result").length;

  return (
    <div className={`turn-card${live ? " turn-live" : ""}`}>
      <button className="turn-header" onClick={onToggle}>
        <span className={`turn-chevron${expanded ? " open" : ""}`}>▸</span>
        <span className="turn-index">#{index + 1}</span>
        <span className="turn-time" title={turn.timestamp}>
          {turn.timestamp ? dayjs(turn.timestamp).fromNow() : ""}
        </span>
        {live && <span className="turn-live-badge">live</span>}
        <span className="turn-prompt">{turn.prompt ? `“${truncate(turn.prompt.text, 90)}”` : "(session start)"}</span>
      </button>

      {!expanded && (
        <div className="turn-summary" onClick={onToggle}>
          {summary.thinkingCount > 0 && <span className="turn-pill">thinking</span>}
          {summary.toolCounts.map((t) => (
            <span className="turn-pill" key={t.name}>
              {t.name}
              {t.count > 1 ? ` ×${t.count}` : ""}
            </span>
          ))}
          {summary.fileEditCount > 0 && (
            <span className="turn-pill">
              {summary.fileEditCount} file{summary.fileEditCount > 1 ? "s" : ""} edited
            </span>
          )}
          {summary.spawnCount > 0 && (
            <span className="turn-pill">
              {summary.spawnCount} sub-agent{summary.spawnCount > 1 ? "s" : ""} spawned
            </span>
          )}
          {summary.hasError && <span className="turn-pill turn-pill-error">error</span>}
          {summary.lastAssistantText && <span className="turn-preview">{truncate(summary.lastAssistantText, 120)}</span>}
        </div>
      )}

      {expanded && (
        <div className="turn-body">
          {turn.prompt && renderEvent(turn.prompt, results)}
          {visibleEvents.map((event) => (
            <Fragment key={event.id}>{renderEvent(event, results)}</Fragment>
          ))}
          {otherCount > 0 && <div className="other-events-hint">{otherCount} other background event(s) hidden</div>}
        </div>
      )}
    </div>
  );
}

function truncate(text: string, max: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max)}…` : singleLine;
}
