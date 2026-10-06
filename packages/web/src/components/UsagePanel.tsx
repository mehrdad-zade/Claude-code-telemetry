import dayjs from "dayjs";
import { totalTokens, type PlanWindow, type TokenUsage, type UsageSummary } from "@agent-tel/shared";
import { formatTokens, usageTooltip } from "../lib/tokens.js";

/** Header strip: tokens used today / this week / this month (calendar,
 * local time), each paired with the closest real plan window from Claude
 * Code's cached `/status` data — the plan's actual windows are a 5-hour
 * session, a week, and a monthly extra-usage budget, not a daily cap. */
export function UsagePanel({ usage }: { usage: UsageSummary | null }) {
  if (!usage) return null;
  const plan = usage.plan;

  return (
    <div className="usage-panel">
      <UsageMeter label="Today" usage={usage.today} window={plan?.session} />
      <UsageMeter label="This week" usage={usage.week} window={plan?.weekly} />
      <UsageMeter label="This month" usage={usage.month} window={plan?.monthly} />
      {plan && plan.fetchedAtMs > 0 && (
        <span
          className="usage-asof"
          title="Plan percentages come from Claude Code's own cache of /status. Run /status (or /usage) in Claude Code to refresh them."
        >
          plan data {dayjs(plan.fetchedAtMs).fromNow()}
        </span>
      )}
    </div>
  );
}

function UsageMeter({ label, usage, window }: { label: string; usage: TokenUsage; window?: PlanWindow }) {
  const resetPassed = window?.resetsAt ? dayjs(window.resetsAt).isBefore(dayjs()) : false;
  const level = !window || resetPassed ? "" : window.percent >= 90 ? "usage-bar-crit" : window.percent >= 75 ? "usage-bar-warn" : "";

  let windowText: string | null = null;
  if (window) {
    if (resetPassed) windowText = `${window.label} reset — run /status`;
    else {
      windowText = `${Math.round(window.percent)}% of ${window.label}`;
      if (window.detail) windowText += ` · ${window.detail}`;
      if (window.resetsAt) windowText += ` · resets ${dayjs(window.resetsAt).fromNow()}`;
    }
  }

  return (
    <div className="usage-meter" title={usageTooltip(usage)}>
      <div className="usage-meter-head">
        <span className="usage-meter-label">{label}</span>
        <span className="usage-meter-value">{formatTokens(totalTokens(usage))} tok</span>
      </div>
      {window && (
        <>
          <div className="usage-bar">
            <div className={`usage-bar-fill ${level}`} style={{ width: `${resetPassed ? 0 : window.percent}%` }} />
          </div>
          <div className="usage-meter-window">{windowText}</div>
        </>
      )}
    </div>
  );
}
