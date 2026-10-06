import { useMemo } from "react";
import dayjs from "dayjs";
import type { NormalizedEvent, ToolResultEvent } from "@agent-tel/shared";
import type { Turn } from "../lib/turns.js";
import { summarizeTurn } from "../lib/turns.js";
import { renderEvent } from "./eventRendering.js";
import { ReasoningBlock } from "./ReasoningBlock.js";
import { groupReasoning } from "../lib/reasoning.js";

export function TurnCard({
  turn,
  index,
  expanded,
  onToggle,
  results,
  live,
  cardRef,
  highlightEventId,
}: {
  turn: Turn;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  results: Map<string, ToolResultEvent>;
  live: boolean;
  cardRef?: (el: HTMLDivElement | null) => void;
  highlightEventId?: string | null;
}) {
  const summary = useMemo(() => summarizeTurn(turn.events), [turn.events]);
  const visibleEvents = useMemo(
    () => turn.events.filter((e: NormalizedEvent) => !(e.kind === "raw" && e.rawType.startsWith("system:"))),
    [turn.events]
  );
  // tool results render with their call and raw lines render nothing, so
  // drop them here rather than leave empty wrappers adding blank gaps.
  const items = useMemo(
    () => groupReasoning(visibleEvents).filter((i) => i.kind === "reasoning" || (i.event.kind !== "tool_result" && i.event.kind !== "raw")),
    [visibleEvents]
  );
  const otherCount = turn.events.length - visibleEvents.filter((e) => e.kind !== "tool_result").length;

  return (
    <div className={`turn-card${live ? " turn-live" : ""}`} ref={cardRef}>
      <button className="turn-header" onClick={onToggle}>
        <span className={`turn-chevron${expanded ? " open" : ""}`}>▸</span>
        <span className="turn-index">#{index + 1}</span>
        <span className="turn-time" title={turn.timestamp}>
          {turn.timestamp ? dayjs(turn.timestamp).fromNow() : ""}
        </span>
        {live && <span className="turn-live-badge">live</span>}
        {turn.prompt?.permissionMode === "plan" && (
          <span className="plan-mode-tag" title="Sent in Claude Code's plan mode">
            📋
          </span>
        )}
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
          {turn.prompt && (
            <div className={turn.prompt.id === highlightEventId ? "event-highlight" : undefined}>
              {renderEvent(turn.prompt, results)}
            </div>
          )}
          {items.map((item) =>
            item.kind === "reasoning" ? (
              <div
                key={item.id}
                className={item.events.some((e) => e.id === highlightEventId) ? "event-highlight" : undefined}
              >
                <ReasoningBlock step={item} />
              </div>
            ) : (
              <div key={item.event.id} className={item.event.id === highlightEventId ? "event-highlight" : undefined}>
                {renderEvent(item.event, results)}
              </div>
            )
          )}
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
