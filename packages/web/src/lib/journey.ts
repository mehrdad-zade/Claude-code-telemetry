import type { NormalizedEvent } from "@agent-tel/shared";
import { splitIntoTurns } from "./turns.js";

export type JourneyStepKind = "tool_call" | "thinking" | "file_edit" | "agent_spawn" | "agent_message" | "text";

export interface JourneyStep {
  id: string;
  kind: JourneyStepKind;
  timestamp: string;
  label: string;
  detail?: string;
  isError?: boolean;
  turnIndex: number;
  /** For agent_spawn/agent_message: the other agent on the other end of the
   * handoff, so a click can jump straight to it. */
  targetAgentId?: string;
}

export interface JourneyTurnMarker {
  turnIndex: number;
  label: string;
}

export interface Journey {
  steps: JourneyStep[];
  turnMarkers: JourneyTurnMarker[];
}

export const STEP_GLYPH: Record<JourneyStepKind, string> = {
  thinking: "\u{1F4AD}", // 💭
  tool_call: "\u{1F527}", // 🔧
  file_edit: "\u{1F4DD}", // 📝
  agent_spawn: "\u{1F9E9}", // 🧩
  agent_message: "\u{2709}\u{FE0F}", // ✉️
  text: "\u{1F4AC}", // 💬
};

export const STEP_COLOR: Record<JourneyStepKind, string> = {
  thinking: "var(--status-thinking)",
  tool_call: "var(--status-tool)",
  file_edit: "var(--status-done)",
  agent_spawn: "#f59e0b",
  agent_message: "#ec4899",
  text: "var(--text-dim)",
};

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function truncate(text: string, max: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max)}…` : singleLine;
}

/** Builds the sequential, chronological "journey" for one agent: every
 * meaningful step it took, in order, grouped by turn — the raw material for
 * the clickable JourneyFlow timeline. Reuses the same turn split as the
 * feed so a step's turnIndex maps directly to a turn card the feed can
 * expand and scroll to. */
export function buildJourney(events: NormalizedEvent[]): Journey {
  const turns = splitIntoTurns(events);

  const resultByToolUseId = new Map<string, boolean>();
  for (const e of events) if (e.kind === "tool_result") resultByToolUseId.set(e.toolUseId, e.isError);

  const steps: JourneyStep[] = [];
  const turnMarkers: JourneyTurnMarker[] = [];

  turns.forEach((turn, turnIndex) => {
    if (turn.prompt) {
      turnMarkers.push({ turnIndex, label: truncate(turn.prompt.text, 60) });
    }
    for (const event of turn.events) {
      const step = toStep(event, turnIndex, resultByToolUseId);
      if (step) steps.push(step);
    }
  });

  return { steps, turnMarkers };
}

function toStep(
  event: NormalizedEvent,
  turnIndex: number,
  resultByToolUseId: Map<string, boolean>
): JourneyStep | null {
  switch (event.kind) {
    case "thinking":
      return { id: event.id, kind: "thinking", timestamp: event.timestamp, label: "Thinking", turnIndex };
    case "tool_call":
      return {
        id: event.id,
        kind: "tool_call",
        timestamp: event.timestamp,
        label: event.name,
        isError: resultByToolUseId.get(event.toolUseId) === true,
        turnIndex,
      };
    case "file_edit":
      return {
        id: event.id,
        kind: "file_edit",
        timestamp: event.timestamp,
        label: basename(event.path),
        detail: event.path,
        turnIndex,
      };
    case "agent_spawn":
      return {
        id: event.id,
        kind: "agent_spawn",
        timestamp: event.timestamp,
        label: `Spawned ${event.subagentType ?? "sub-agent"}`,
        detail: event.description,
        turnIndex,
        targetAgentId: event.childAgentId,
      };
    case "agent_message":
      return {
        id: event.id,
        kind: "agent_message",
        timestamp: event.timestamp,
        label: "Message",
        detail: event.preview,
        turnIndex,
        targetAgentId: event.toAgentId,
      };
    case "text":
      if (event.isHumanPrompt) return null; // rendered as a turn marker instead
      return { id: event.id, kind: "text", timestamp: event.timestamp, label: "Replied", detail: event.text, turnIndex };
    default:
      return null;
  }
}
