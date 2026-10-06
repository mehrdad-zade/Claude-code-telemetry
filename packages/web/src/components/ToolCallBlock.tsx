import { PLAN_TOOL_NAME, findPlans, type ToolCallEvent, type ToolResultEvent } from "@agent-tel/shared";
import { toolCallLabel } from "../lib/activity.js";
import { Markdown } from "./Markdown.js";
import { ToolInput, ToolResultBody, hasResultContent, resultSummary, splitMcpName } from "./toolRendering.js";

const PLAN_STATUS = {
  approved: { label: "approved", className: "ok" },
  rejected: { label: "rejected", className: "error" },
  pending: { label: "awaiting approval", className: "pending" },
} as const;

/** The plan the agent presented in plan mode, rendered as a document rather
 * than a raw tool call: title, approval status, the full plan (the approved
 * text when you edited it before approving) and any rejection feedback. */
function PlanBlock({ call, result, time }: { call: ToolCallEvent; result?: ToolResultEvent; time?: string }) {
  const plan = findPlans(result ? [call, result] : [call])[0];
  const status = PLAN_STATUS[plan.status];
  return (
    <div className={`event-block plan-block plan-${plan.status}`}>
      <div className="event-label">
        <span>
          📋 <span className="tool-name">Plan</span>
          <span className="tool-label"> · {plan.title}</span>
        </span>
        <span className={`tool-status ${status.className}`}>{status.label}</span>
        {time && <span className="event-time">{time}</span>}
      </div>
      {plan.filePath && (
        <div className="tool-path">
          <code>{plan.filePath}</code>
        </div>
      )}
      {plan.feedback && (
        <div className="plan-feedback">
          <strong>Your feedback:</strong> {plan.feedback}
        </div>
      )}
      <details className="plan-body" open={plan.status !== "rejected"}>
        <summary>plan details · {plan.text.split("\n").length} lines</summary>
        {plan.text ? <Markdown text={plan.text} /> : <div className="viz-box-empty">(plan text not recorded)</div>}
      </details>
    </div>
  );
}

export function ToolCallBlock({ call, result, time }: { call: ToolCallEvent; result?: ToolResultEvent; time?: string }) {
  if (call.name === PLAN_TOOL_NAME) return <PlanBlock call={call} result={result} time={time} />;
  const label = toolCallLabel(call);
  const mcp = splitMcpName(call.name);
  const showResult = result && hasResultContent(result.content);
  // Screenshots are the point of a browser step — show them without a click.
  const hasImage = Array.isArray(result?.content) && result!.content.some((b: any) => b?.type === "image");

  return (
    <div className={`event-block tool-call-block${result?.isError ? " tool-error" : ""}`}>
      <div className="event-label">
        <span>
          🔧{" "}
          <span className="tool-name" title={call.name}>
            {mcp ? (
              <>
                <span className="tool-server">{mcp.server.replace(/^claude[-_]in[-_]|^claude_ai_/i, "")}</span> {mcp.tool}
              </>
            ) : (
              call.name
            )}
          </span>
          {label && call.name !== "Bash" && !mcp && <span className="tool-label"> · {label}</span>}
        </span>
        {result ? (
          result.isError ? (
            <span className="tool-status error">failed</span>
          ) : (
            <span className="tool-status ok">done</span>
          )
        ) : (
          <span className="tool-status pending">running…</span>
        )}
        {time && <span className="event-time">{time}</span>}
      </div>
      <ToolInput call={call} />
      {showResult && (
        <details className="tool-result" open={result!.isError || hasImage}>
          <summary>
            {result!.isError ? "error" : "result"} · {resultSummary(result!.content) || "empty"}
          </summary>
          <ToolResultBody content={result!.content} />
        </details>
      )}
    </div>
  );
}
