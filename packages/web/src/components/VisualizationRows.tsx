import { useState } from "react";
import dayjs from "dayjs";
import { totalTokens } from "@agent-tel/shared";
import type { AgentActivity, TokenBreakdown, TurnRow } from "../lib/turnGroups.js";
import type { ActivityCategory } from "../lib/activity.js";
import { formatTokens, modelDisplayName, usageTooltip } from "../lib/tokens.js";

function activateOnKey(fn: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

/** The main visualization: one horizontal row per instruction/response
 * cycle — Instruction → one Activity box per agent that worked in that turn
 * → Response. Boxes are a fixed, compact size; clicking an Activity box
 * highlights it and opens its full breakdown in the free space to the right
 * of the Response box, where each category jumps straight to the log. */
export function VisualizationRows({
  rows,
  agentColors,
  onOpenEvent,
}: {
  rows: TurnRow[];
  agentColors: Map<string, string>;
  /** Show this event (belonging to this agent) in the log. */
  onOpenEvent: (agentId: string, eventId: string) => void;
}) {
  // rowKey -> agentId whose Activity box is open in that row
  const [openBoxes, setOpenBoxes] = useState<Map<string, string>>(new Map());

  if (rows.length === 0) {
    return (
      <div className="viz-rows">
        <div className="empty-hint">No activity yet.</div>
      </div>
    );
  }

  function toggle(rowKey: string, agentId: string) {
    setOpenBoxes((prev) => {
      const next = new Map(prev);
      if (next.get(rowKey) === agentId) next.delete(rowKey);
      else next.set(rowKey, agentId);
      return next;
    });
  }

  return (
    <div className="viz-rows">
      {rows.map((row) => {
        const main = row.agents[0];
        const focusFirst = () => row.firstEventId && onOpenEvent(main.agentId, row.firstEventId);
        const focusResponse = () =>
          onOpenEvent(main.agentId, row.lastAssistantEventId ?? row.firstEventId ?? "");
        const openAgent = row.agents.find((a) => a.agentId === openBoxes.get(row.key));

        return (
          <div className="viz-row-group" key={row.key}>
            <div className={`viz-row${openAgent ? " viz-row-open" : ""}`}>
              <div className="viz-row-time" title={`${row.timestamp}\n\n${breakdownTooltip(row.tokens.total)}`}>
                <div>{row.timestamp ? dayjs(row.timestamp).format("MMM D, h:mm A") : ""}</div>
                {totalTokens(row.tokens.total.total) > 0 && (
                  <div className="viz-row-total">{formatTokens(totalTokens(row.tokens.total.total))} tok</div>
                )}
              </div>
              <div className="viz-row-flow">
                <div
                  className="viz-box viz-box-instruction"
                  role="button"
                  tabIndex={0}
                  onClick={focusFirst}
                  onKeyDown={activateOnKey(focusFirst)}
                  title={row.promptText}
                >
                  <div className="viz-box-label">
                    Instruction
                    {row.tokens.instructionApprox > 0 && (
                      <span
                        className="viz-box-tokens"
                        title="Approximate size of the prompt text (~4 chars per token). It's billed as part of the first API call's input, which is already counted in Activity/Response."
                      >
                        ~{formatTokens(row.tokens.instructionApprox)} tok
                      </span>
                    )}
                  </div>
                  <div className="viz-box-text">{row.promptText ?? "(session start)"}</div>
                </div>

                <span className="viz-arrow">→</span>

                <div className="viz-activity-group">
                  {row.agents.map((agent) => (
                    <ActivityBox
                      key={agent.agentId}
                      agent={agent}
                      color={agentColors.get(agent.agentId)}
                      open={agent === openAgent}
                      onToggle={() => toggle(row.key, agent.agentId)}
                    />
                  ))}
                </div>

                <span className="viz-arrow">→</span>

                <div
                  className="viz-box viz-box-response"
                  role="button"
                  tabIndex={0}
                  onClick={focusResponse}
                  onKeyDown={activateOnKey(focusResponse)}
                  title={row.summary.lastAssistantText}
                >
                  <div className="viz-box-label">
                    Response
                    <TokenTag breakdown={row.tokens.response} />
                  </div>
                  <div className="viz-box-text">{row.summary.lastAssistantText ? stripMarkdown(row.summary.lastAssistantText) : "—"}</div>
                </div>

                {openAgent && (
                  <ActivityPanel
                    key={openAgent.agentId}
                    agent={openAgent}
                    color={agentColors.get(openAgent.agentId)}
                    onOpenEvent={onOpenEvent}
                    onClose={() => toggle(row.key, openAgent.agentId)}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const PILLS_SHOWN = 4;

/** Fixed-size summary of one agent's work in a turn. Shows the top few
 * category pills; the rest are counted in a "+N more" hint. */
function ActivityBox({
  agent,
  color,
  open,
  onToggle,
}: {
  agent: AgentActivity;
  color?: string;
  open: boolean;
  onToggle: () => void;
}) {
  const hidden = agent.categories.length - PILLS_SHOWN;
  return (
    <div
      className={`viz-box viz-box-activity${open ? " viz-box-open" : ""}`}
      style={color ? { borderLeftColor: color } : undefined}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={activateOnKey(onToggle)}
      title={`${agent.label} — click ${open ? "to close" : "for"} the full breakdown\n\n${agent.categories
        .map((c) => `${c.icon} ${c.label} ×${c.count}`)
        .join("\n")}`}
    >
      <div className="viz-box-label">
        <span className="viz-box-agent">
          {open && <span className="viz-box-open-mark">▶ </span>}
          {agent.isMain ? "Activity" : `🧩 ${agent.label}`}
        </span>
        <TokenTag breakdown={agent.tokens} />
      </div>
      <div className="viz-box-pills">
        {agent.categories.slice(0, PILLS_SHOWN).map((c) => (
          <span className={`turn-pill${c.isError ? " turn-pill-error" : ""}`} key={c.key}>
            {c.icon} {c.label}
            {c.count > 1 ? ` ×${c.count}` : ""}
          </span>
        ))}
        {agent.categories.length === 0 && <span className="viz-box-empty">—</span>}
      </div>
      {hidden > 0 && !open && <div className="viz-box-more">+{hidden} more · click to expand</div>}
      {open && <div className="viz-box-more">open → · click to close</div>}
    </div>
  );
}

/** The full breakdown for one Activity box, shown to the right of the
 * Response box. Every category is a chip that jumps straight to the log;
 * clicking the same chip again steps to its next occurrence ("3/12"). */
function ActivityPanel({
  agent,
  color,
  onOpenEvent,
  onClose,
}: {
  agent: AgentActivity;
  color?: string;
  onOpenEvent: (agentId: string, eventId: string) => void;
  onClose: () => void;
}) {
  // category key -> index of the occurrence last opened
  const [cursor, setCursor] = useState<Record<string, number>>({});

  function open(category: ActivityCategory) {
    const idx = cursor[category.key] === undefined ? 0 : (cursor[category.key] + 1) % category.count;
    setCursor((prev) => ({ ...prev, [category.key]: idx }));
    onOpenEvent(agent.agentId, category.items[idx].eventId);
  }

  return (
    <div className="viz-panel" style={color ? { borderLeftColor: color } : undefined}>
      <div className="viz-panel-header">
        <span className="viz-panel-title">{agent.isMain ? "Main agent" : `🧩 ${agent.label}`} · breakdown</span>
        <TokenTag breakdown={agent.tokens} />
        <button className="viz-panel-close" onClick={onClose} title="Close" aria-label="Close breakdown">
          ×
        </button>
      </div>
      {agent.categories.length === 0 && <div className="viz-box-empty">No activity.</div>}
      <div className="viz-panel-chips">
        {agent.categories.map((c) => {
          const at = cursor[c.key];
          const current = at === undefined ? undefined : c.items[at];
          return (
            <button
              key={c.key}
              className={`viz-chip${c.isError ? " viz-chip-error" : ""}${at !== undefined ? " viz-chip-visited" : ""}`}
              onClick={() => open(c)}
              title={
                c.count === 1
                  ? `${c.label}: ${c.items[0].label}\nClick to open in the log`
                  : `${c.label} ×${c.count}\nClick to open in the log; click again for the next one` +
                    (current ? `\nShowing: ${current.label}` : "")
              }
            >
              <span>{c.icon}</span>
              <span className="viz-chip-label">{c.label}</span>
              <span className="viz-chip-count">{at !== undefined && c.count > 1 ? `${at + 1}/${c.count}` : c.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TokenTag({ breakdown }: { breakdown: TokenBreakdown }) {
  const total = totalTokens(breakdown.total);
  if (total === 0) return null;
  return (
    <span className="viz-box-tokens" title={breakdownTooltip(breakdown)}>
      {formatTokens(total)} tok
    </span>
  );
}

function breakdownTooltip(breakdown: TokenBreakdown): string {
  const lines = breakdown.byModel.map((m) => `${modelDisplayName(m.model)}: ${formatTokens(totalTokens(m.usage))}`);
  return [...lines, "", usageTooltip(breakdown.total)].join("\n");
}

/** Plain-text preview of Markdown for the tiny box (no `**`, `#`, backticks). */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*`#>]+/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
