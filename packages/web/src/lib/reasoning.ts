import type { NormalizedEvent, TextEvent, ThinkingEvent } from "@agent-tel/shared";
import { toolCallLabel } from "./activity.js";

/** One reasoning step: a run of thinking blocks and the assistant's
 * in-between narration, with no action between them. Claude Code usually
 * doesn't save the thinking text itself, but the narration it writes in the
 * same message is the visible part of that same thought process — so the
 * two are shown together as one step. */
export interface ReasoningStep {
  kind: "reasoning";
  id: string;
  events: Array<ThinkingEvent | TextEvent>;
  /** Every non-empty piece of text in the step, in order. */
  texts: Array<{ source: "thinking" | "narration"; text: string }>;
  /** Number of thinking blocks whose text wasn't recorded. */
  unrecordedThinking: number;
  /** What the agent did right after this step, e.g. "🔧 Bash — npm test". */
  next?: string;
}

export type LogItem = ReasoningStep | { kind: "event"; event: NormalizedEvent };

/** Events that render nothing visible in the log, so they don't break up a
 * reasoning step (tool results are shown with their call; raw/system lines
 * are hidden). */
function isTransparent(e: NormalizedEvent): boolean {
  return e.kind === "tool_result" || e.kind === "raw";
}

function describeNext(e: NormalizedEvent): string | undefined {
  if (e.kind === "tool_call") {
    const label = toolCallLabel(e);
    return `🔧 ${e.name}${label ? ` — ${label}` : ""}`;
  }
  if (e.kind === "text" && !e.isHumanPrompt) return "💬 replied";
  if (e.kind === "file_edit") return `📝 edited ${e.path.split("/").pop()}`;
  if (e.kind === "agent_spawn") return "🧩 spawned a sub-agent";
  return undefined;
}

/** Groups one turn's events for display: consecutive thinking + narration
 * become a single ReasoningStep; everything else passes through. The turn's
 * final assistant text is the Response, so it's never folded in. */
export function groupReasoning(events: NormalizedEvent[]): LogItem[] {
  const finalText = [...events].reverse().find((e) => e.kind === "text" && !e.isHumanPrompt);
  const items: LogItem[] = [];
  let current: ReasoningStep | null = null;

  for (const e of events) {
    const isReasoning = e.kind === "thinking" || (e.kind === "text" && !e.isHumanPrompt && e !== finalText);
    if (isReasoning) {
      if (!current) {
        current = { kind: "reasoning", id: e.id, events: [], texts: [], unrecordedThinking: 0 };
        items.push(current);
      }
      current.events.push(e);
      if (e.text) current.texts.push({ source: e.kind === "thinking" ? "thinking" : "narration", text: e.text });
      else current.unrecordedThinking++;
      continue;
    }
    if (isTransparent(e)) {
      items.push({ kind: "event", event: e });
      continue;
    }
    if (current) current.next = describeNext(e);
    current = null;
    items.push({ kind: "event", event: e });
  }
  return items;
}

export function reasoningSteps(events: NormalizedEvent[]): ReasoningStep[] {
  return groupReasoning(events).filter((i): i is ReasoningStep => i.kind === "reasoning");
}
