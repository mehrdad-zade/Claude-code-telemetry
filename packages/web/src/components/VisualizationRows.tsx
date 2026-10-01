import dayjs from "dayjs";
import type { TurnRow } from "../lib/turnGroups.js";

function activateOnKey(fn: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

/** The main visualization: one horizontal row per instruction/response
 * cycle, each row a small flow of meaningful, clickable boxes —
 * Instruction → Activity (everything the agent did: thinking, tools, file
 * edits, any hand-offs) → Response — rather than a static tree of two
 * boxes. A new instruction always starts a new row.
 *
 * The outer boxes are `div[role=button]`, not `<button>`, specifically so
 * the Activity box can contain its own real `<button>` hand-off chips —
 * a button nested inside a button is invalid HTML and silently breaks
 * click targeting/event isolation in the browser. */
export function VisualizationRows({
  rows,
  onFocusEvent,
  onJumpToAgent,
}: {
  rows: TurnRow[];
  onFocusEvent: (eventId: string) => void;
  onJumpToAgent: (agentId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="viz-rows">
        <div className="empty-hint">No activity yet.</div>
      </div>
    );
  }

  return (
    <div className="viz-rows">
      {rows.map((row) => {
        const focusFirst = () => row.firstEventId && onFocusEvent(row.firstEventId);
        const focusResponse = () => onFocusEvent(row.lastAssistantEventId ?? row.firstEventId ?? "");

        return (
          <div className="viz-row" key={row.key}>
            <div className="viz-row-time" title={row.timestamp}>
              {row.timestamp ? dayjs(row.timestamp).format("MMM D, h:mm A") : ""}
            </div>
            <div className="viz-row-flow">
              <div
                className="viz-box viz-box-instruction"
                role="button"
                tabIndex={0}
                onClick={focusFirst}
                onKeyDown={activateOnKey(focusFirst)}
              >
                <div className="viz-box-label">Instruction</div>
                <div className="viz-box-text">{row.promptText ?? "(session start)"}</div>
              </div>

              <span className="viz-arrow">→</span>

              <div
                className="viz-box viz-box-activity"
                role="button"
                tabIndex={0}
                onClick={focusFirst}
                onKeyDown={activateOnKey(focusFirst)}
              >
                <div className="viz-box-label">Activity</div>
                <div className="viz-box-pills">
                  {row.summary.thinkingCount > 0 && <span className="turn-pill">💭 thinking</span>}
                  {row.summary.toolCounts.map((t) => (
                    <span className="turn-pill" key={t.name}>
                      🔧 {t.name}
                      {t.count > 1 ? ` ×${t.count}` : ""}
                    </span>
                  ))}
                  {row.summary.fileEditCount > 0 && <span className="turn-pill">📝 {row.summary.fileEditCount} edited</span>}
                  {row.summary.hasError && <span className="turn-pill turn-pill-error">⚠️ error</span>}
                  {row.summary.toolCounts.length === 0 && row.summary.thinkingCount === 0 && row.summary.fileEditCount === 0 && (
                    <span className="viz-box-empty">—</span>
                  )}
                </div>
                {(row.spawns.length > 0 || row.messages.length > 0) && (
                  <div className="viz-handoffs">
                    {row.spawns.map((s) => (
                      <button
                        key={s.id}
                        className="viz-handoff-chip"
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpToAgent(s.targetAgentId);
                        }}
                      >
                        🧩 spawned {s.label}
                      </button>
                    ))}
                    {row.messages.map((m) => (
                      <button
                        key={m.id}
                        className="viz-handoff-chip"
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpToAgent(m.targetAgentId);
                        }}
                      >
                        ✉️ {truncate(m.label, 36)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <span className="viz-arrow">→</span>

              <div
                className="viz-box viz-box-response"
                role="button"
                tabIndex={0}
                onClick={focusResponse}
                onKeyDown={activateOnKey(focusResponse)}
              >
                <div className="viz-box-label">Response</div>
                <div className="viz-box-text">{row.summary.lastAssistantText ? truncate(row.summary.lastAssistantText, 140) : "—"}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function truncate(text: string, max: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max)}…` : singleLine;
}
