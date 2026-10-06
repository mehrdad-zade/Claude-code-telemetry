import { useState } from "react";
import dayjs from "dayjs";
import { VOTER_LABELS, totalTokens, type RequirementVerdict, type TurnValidation, type VoterName } from "@agent-tel/shared";
import type { AgentActivity, TokenBreakdown, TurnRow } from "../lib/turnGroups.js";
import type { ActivityCategory } from "../lib/activity.js";
import { formatTokens, modelDisplayName, usageTooltip } from "../lib/tokens.js";
import { InfoPopover } from "./InfoPopover.js";

function activateOnKey(fn: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

/** The main visualization: one horizontal row per instruction/response
 * cycle — Instruction → Activity → Response, with the time, token total and
 * validation score in the left column. The Activity box sums up every agent
 * that worked in the turn; clicking it opens the full breakdown, one section
 * per agent, in the free space to the right of the Response box, where each
 * category jumps straight to the log. */
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
  // rows whose Activity breakdown is open
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  if (rows.length === 0) {
    return (
      <div className="viz-rows">
        <div className="empty-hint">No activity yet.</div>
      </div>
    );
  }

  function toggle(rowKey: string) {
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
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
        const open = openRows.has(row.key);

        return (
          <div className="viz-row-group" key={row.key}>
            <div className={`viz-row${open ? " viz-row-open" : ""}`}>
              <div className="viz-row-time">
                <div title={row.timestamp}>{row.timestamp ? dayjs(row.timestamp).format("MMM D, h:mm A") : ""}</div>
                {totalTokens(row.tokens.total.total) > 0 && (
                  <div className="viz-row-total" title={breakdownTooltip(row.tokens.total)}>
                    {formatTokens(totalTokens(row.tokens.total.total))} tok
                  </div>
                )}
                <ValidationScore validation={row.validation} onOpenEvent={onOpenEvent} />
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
                    <span>
                      Instruction
                      {(row.planMode || row.plan) && (
                        <PlanBadge row={row} onOpen={() => onOpenEvent(row.plan?.agentId ?? main.agentId, row.plan?.eventId ?? row.firstEventId ?? "")} />
                      )}
                    </span>
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

                <ActivityBox row={row} agentColors={agentColors} open={open} onToggle={() => toggle(row.key)} />

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

                {open && (
                  <ActivityPanel row={row} agentColors={agentColors} onOpenEvent={onOpenEvent} onClose={() => toggle(row.key)} />
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

/** Every agent's categories combined by key ("Bash ×3" + "Bash ×2" → "Bash ×5"). */
function mergeCategories(agents: AgentActivity[]): ActivityCategory[] {
  const merged = new Map<string, ActivityCategory>();
  for (const agent of agents) {
    for (const c of agent.categories) {
      const prev = merged.get(c.key);
      if (prev) merged.set(c.key, { ...prev, count: prev.count + c.count, items: [...prev.items, ...c.items] });
      else merged.set(c.key, c);
    }
  }
  return [...merged.values()];
}

/** Fixed-size summary of all the work in a turn, across every agent. Shows
 * the top few category pills; the rest are counted in a "+N more" hint.
 * Coloured dots mark each agent that took part. */
function ActivityBox({
  row,
  agentColors,
  open,
  onToggle,
}: {
  row: TurnRow;
  agentColors: Map<string, string>;
  open: boolean;
  onToggle: () => void;
}) {
  const categories = mergeCategories(row.agents);
  const hidden = categories.length - PILLS_SHOWN;
  const multi = row.agents.length > 1;
  return (
    <div
      className={`viz-box viz-box-activity${open ? " viz-box-open" : ""}`}
      style={{ borderLeftColor: agentColors.get(row.agents[0].agentId) }}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={activateOnKey(onToggle)}
      title={`Click ${open ? "to close" : "for the full breakdown"}${multi ? ", one section per agent" : ""}\n\n${categories
        .map((c) => `${c.icon} ${c.label} ×${c.count}`)
        .join("\n")}`}
    >
      <div className="viz-box-label">
        <span className="viz-box-agent">
          {open && <span className="viz-box-open-mark">▶ </span>}
          Activity
          {multi && (
            <span className="viz-agent-dots" title={row.agents.map((a) => a.label).join("\n")}>
              {row.agents.map((a) => (
                <span key={a.agentId} className="agent-color-dot" style={{ background: agentColors.get(a.agentId) }} />
              ))}
              {row.agents.length} agents
            </span>
          )}
        </span>
        <TokenTag breakdown={row.tokens.activity} />
      </div>
      <div className="viz-box-pills">
        {categories.slice(0, PILLS_SHOWN).map((c) => (
          <span className={`turn-pill${c.isError ? " turn-pill-error" : ""}`} key={c.key}>
            {c.icon} {c.label}
            {c.count > 1 ? ` ×${c.count}` : ""}
          </span>
        ))}
        {categories.length === 0 && <span className="viz-box-empty">—</span>}
      </div>
      {hidden > 0 && !open && <div className="viz-box-more">+{hidden} more · click to expand</div>}
      {open && <div className="viz-box-more">open → · click to close</div>}
    </div>
  );
}

/** The full Activity breakdown, shown to the right of the Response box: one
 * section per agent (main agent first). Every category is a chip that jumps
 * straight to the log; clicking the same chip again steps to its next
 * occurrence ("3/12"). */
function ActivityPanel({
  row,
  agentColors,
  onOpenEvent,
  onClose,
}: {
  row: TurnRow;
  agentColors: Map<string, string>;
  onOpenEvent: (agentId: string, eventId: string) => void;
  onClose: () => void;
}) {
  // "agentId|category key" -> index of the occurrence last opened
  const [cursor, setCursor] = useState<Record<string, number>>({});

  function open(agent: AgentActivity, category: ActivityCategory) {
    const key = `${agent.agentId}|${category.key}`;
    const idx = cursor[key] === undefined ? 0 : (cursor[key] + 1) % category.count;
    setCursor((prev) => ({ ...prev, [key]: idx }));
    onOpenEvent(agent.agentId, category.items[idx].eventId);
  }

  const multi = row.agents.length > 1;
  return (
    <div className="viz-panel" style={{ borderLeftColor: agentColors.get(row.agents[0].agentId) }}>
      <div className="viz-panel-header">
        <span className="viz-panel-title">Activity · breakdown{multi ? ` · ${row.agents.length} agents` : ""}</span>
        <TokenTag breakdown={row.tokens.activity} />
        <button className="viz-panel-close" onClick={onClose} title="Close" aria-label="Close breakdown">
          ×
        </button>
      </div>
      {row.agents.map((agent) => (
        <div className={multi ? "viz-panel-agent" : undefined} key={agent.agentId} style={multi ? { borderLeftColor: agentColors.get(agent.agentId) } : undefined}>
          {multi && (
            <div className="viz-panel-agent-header">
              <span className="agent-color-dot" style={{ background: agentColors.get(agent.agentId) }} />
              <span className="viz-panel-agent-name">{agent.isMain ? "Main agent" : `🧩 ${agent.label}`}</span>
              <TokenTag breakdown={agent.tokens} />
            </div>
          )}
          {agent.categories.length === 0 && <div className="viz-box-empty">No activity.</div>}
          <div className="viz-panel-chips">
            {agent.categories.map((c) => {
              const at = cursor[`${agent.agentId}|${c.key}`];
              const current = at === undefined ? undefined : c.items[at];
              return (
                <button
                  key={c.key}
                  className={`viz-chip${c.isError ? " viz-chip-error" : ""}${at !== undefined ? " viz-chip-visited" : ""}`}
                  onClick={() => open(agent, c)}
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
      ))}
    </div>
  );
}

const PLAN_STATUS_LABEL = { approved: "approved", rejected: "rejected", pending: "awaiting approval" } as const;

/** Marks an instruction sent in plan mode (or a turn that presented a plan);
 * clicking it opens the plan in the log. */
function PlanBadge({ row, onOpen }: { row: TurnRow; onOpen: () => void }) {
  const plan = row.plan;
  const title = plan
    ? `Plan mode · ${plan.title}\nStatus: ${PLAN_STATUS_LABEL[plan.status]}${plan.status === "approved" ? "\nIts steps are part of this turn's validation." : ""}\n\nClick to open the plan in the log`
    : "Sent in plan mode — no plan was presented in this turn";
  return (
    <span
      className={`viz-plan-badge viz-plan-${plan?.status ?? "none"}`}
      role="button"
      tabIndex={0}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onOpen();
        }
      }}
    >
      📋 Plan{plan && plan.status !== "approved" ? ` · ${PLAN_STATUS_LABEL[plan.status]}` : ""}
    </span>
  );
}

const CONFIDENCE_LABEL = { high: "High", medium: "Med", low: "Low" } as const;

/** The voters broken out per requirement in the hover table; the other two
 * (reasoning, follow-up) still count and are listed in the score's tooltip. */
const BREAKDOWN_VOTERS: VoterName[] = ["coverage", "actionFit", "outcome", "responseClaim", "verification"];
const EXTRA_VOTERS: VoterName[] = ["reasoning", "followUp"];

function verdictIcon(verdict: string): string {
  return verdict === "met" ? "✅" : verdict === "partial" ? "🟡" : "❌";
}

function pct(p: number): string {
  return `${Math.round(p * 100)}`;
}

/** The turn's validation score in the left column, with an "i" that shows
 * the per-requirement breakdown on hover. */
function ValidationScore({
  validation,
  onOpenEvent,
}: {
  validation: TurnValidation;
  onOpenEvent: (agentId: string, eventId: string) => void;
}) {
  if (validation.skipped) {
    return (
      <div className="viz-row-validation viz-validation-muted" title="Slash commands aren't tasks, so they aren't scored.">
        Validation n/a
      </div>
    );
  }
  if (validation.pending) {
    return (
      <div className="viz-row-validation viz-validation-muted" title="Scored once the agent replies.">
        validating…
      </div>
    );
  }
  return (
    <div className="viz-row-validation">
      <span className={`viz-validation-number viz-verdict-${validation.verdict}`}>
        {verdictIcon(validation.verdict)} {validation.accuracy}%
      </span>
      <InfoPopover label="Validation details">
        <ValidationDetails validation={validation} onOpenEvent={onOpenEvent} />
      </InfoPopover>
    </div>
  );
}

function ValidationDetails({
  validation,
  onOpenEvent,
}: {
  validation: TurnValidation;
  onOpenEvent: (agentId: string, eventId: string) => void;
}) {
  const prompt = validation.requirements.filter((r) => r.requirement.source === "prompt");
  const plan = validation.requirements.filter((r) => r.requirement.source === "plan");
  const twoGroups = prompt.length > 0 && plan.length > 0;
  return (
    <div className="validation-details">
      <div className="info-popover-title">
        Validation {validation.accuracy}% · {CONFIDENCE_LABEL[validation.confidenceLevel]} confidence ({pct(validation.confidence)}%)
      </div>
      {validation.plan && (
        <button className="viz-chip validation-plan-link" onClick={() => onOpenEvent(validation.plan!.agentId, validation.plan!.eventId)} title="Open the plan in the log">
          <span className="viz-chip-label">
            📋 {validation.plan.inherited ? "Plan from the previous turn" : "Plan"} · {PLAN_STATUS_LABEL[validation.plan.status]} · {validation.plan.title}
          </span>
        </button>
      )}
      <table className="validation-table">
        <thead>
          <tr>
            <th className="validation-req-col">Requirement</th>
            <th>Score</th>
            {BREAKDOWN_VOTERS.map((v) => (
              <th key={v}>{VOTER_LABELS[v]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <RequirementRows title={twoGroups ? `From your instruction · ${validation.promptAccuracy}%` : undefined} reqs={prompt} />
          <RequirementRows title={plan.length ? `From the approved plan (work after approval) · ${validation.planAccuracy}%` : undefined} reqs={plan} />
        </tbody>
      </table>
      <div className="info-popover-note">
        ✅ met ≥ 70 · 🟡 partial ≥ 40 · ❌ unmet. "–" means the voter had no evidence and abstained. Hover a cell for its reason; reasoning
        and follow-up votes are in the score's tooltip.
      </div>
    </div>
  );
}

function RequirementRows({ title, reqs }: { title?: string; reqs: RequirementVerdict[] }) {
  if (reqs.length === 0) return null;
  return (
    <>
      {title && (
        <tr className="validation-group-row">
          <td colSpan={2 + BREAKDOWN_VOTERS.length}>{title}</td>
        </tr>
      )}
      {reqs.map((r, i) => {
        const vote = (name: VoterName) => r.votes.find((v) => v.voter === name);
        const extras = EXTRA_VOTERS.map((name) => {
          const v = vote(name);
          return `${VOTER_LABELS[name]}: ${v?.p == null ? "–" : pct(v.p)} — ${v?.reason ?? ""}`;
        }).join("\n");
        return (
          <tr key={i}>
            <td className="validation-req-col" title={r.requirement.text}>
              {verdictIcon(r.verdict)} {r.requirement.inherited && <em>(continued) </em>}
              {r.requirement.text}
            </td>
            <td className={`validation-score viz-verdict-${r.verdict}`} title={`Confidence ${pct(r.confidence)}%\n${extras}`}>
              {pct(r.score)}
            </td>
            {BREAKDOWN_VOTERS.map((name) => {
              const v = vote(name);
              const abstain = v?.p == null;
              return (
                <td key={name} className={abstain ? "validation-abstain" : voteClass(v!.p!)} title={v?.reason}>
                  {abstain ? "–" : pct(v!.p!)}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}

function voteClass(p: number): string {
  return p >= 0.7 ? "viz-verdict-met" : p >= 0.4 ? "viz-verdict-partial" : "viz-verdict-unmet";
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
