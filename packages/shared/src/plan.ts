// Claude Code plan mode, as it shows up in normalized events: the agent
// presents its plan by calling ExitPlanMode (`input.plan`, `input.planFilePath`)
// and the tool result says whether the user approved it. Prompts typed while
// in plan mode carry `permissionMode: "plan"` on their TextEvent.

import type { NormalizedEvent, TextEvent, ToolResultEvent } from "./events.js";

export const PLAN_TOOL_NAME = "ExitPlanMode";

export type PlanStatus = "approved" | "rejected" | "pending";

export interface PlanInfo {
  /** The ExitPlanMode tool_call event. */
  eventId: string;
  agentId: string;
  toolUseId: string;
  /** The approved text when the result carries one (the user may have edited
   * the plan before approving), otherwise what the agent proposed. */
  text: string;
  title: string;
  filePath?: string;
  status: PlanStatus;
  /** What the user said when rejecting the plan. */
  feedback?: string;
  timestamp: string;
}

export function isPlanModePrompt(event: TextEvent | undefined): boolean {
  return !!event?.isHumanPrompt && event.permissionMode === "plan";
}

/** Plan files Claude Code writes while planning (`~/.claude/plans/*.md`) —
 * scaffolding for the plan, not part of the deliverable. */
export function isPlanFilePath(path: string | undefined): boolean {
  return !!path && /[\\/]\.claude[\\/]plans[\\/]/.test(path);
}

export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join("\n");
  }
  return "";
}

export function planTitle(text: string): string {
  const heading = text.match(/^\s*#{1,3}\s+(.+)$/m)?.[1];
  const first = heading ?? text.split("\n").find((l) => l.trim()) ?? "Plan";
  return first.replace(/[*`_]/g, "").trim().slice(0, 120);
}

/** Every plan presented in these events, in order. */
export function findPlans(events: NormalizedEvent[]): PlanInfo[] {
  const results = new Map<string, ToolResultEvent>();
  for (const e of events) if (e.kind === "tool_result") results.set(e.toolUseId, e);

  const plans: PlanInfo[] = [];
  for (const e of events) {
    if (e.kind !== "tool_call" || e.name !== PLAN_TOOL_NAME) continue;
    const input = (e.input && typeof e.input === "object" ? e.input : {}) as { plan?: unknown; planFilePath?: unknown };
    const result = results.get(e.toolUseId);
    const body = result ? resultText(result.content) : "";

    let status: PlanStatus = "pending";
    let feedback: string | undefined;
    let text = typeof input.plan === "string" ? input.plan : "";
    if (result) {
      if (result.isError || /doesn'?t want to proceed|rejected/i.test(body.slice(0, 300))) {
        status = "rejected";
        feedback = body.match(/the user said:\s*([\s\S]+)$/i)?.[1]?.trim();
      } else {
        status = "approved";
        const approved = body.match(/##\s*Approved Plan:?\s*\n([\s\S]+)$/i)?.[1]?.trim();
        if (approved) text = approved;
      }
    }
    plans.push({
      eventId: e.id,
      agentId: e.agentId,
      toolUseId: e.toolUseId,
      text,
      title: planTitle(text),
      filePath: typeof input.planFilePath === "string" ? input.planFilePath : undefined,
      status,
      feedback,
      timestamp: e.timestamp,
    });
  }
  return plans;
}
