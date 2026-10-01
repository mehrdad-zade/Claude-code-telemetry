import type { NormalizedEvent } from "@agent-tel/shared";

export type StepKind = "thinking" | "tool_call" | "file_edit" | "agent_spawn" | "agent_message";

export interface Step {
  id: string;
  kind: StepKind;
  timestamp: string;
  toolName?: string;
  isError?: boolean;
}

export interface AgentStats {
  totalEvents: number;
  thinkingCount: number;
  toolCounts: Array<{ name: string; count: number }>;
  totalToolCalls: number;
  fileEditCount: number;
  spawnCount: number;
  messageCount: number;
  errorCount: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  /** Chronological, capped sequence of notable steps — the raw material for
   * the on-node "process" sparkline. */
  steps: Step[];
}

/** Aggregates ALL of one agent's events (not just one turn) into the summary
 * shown directly on its graph node — tool usage, counts, and a step
 * timeline — so you can see what an agent has been doing without clicking
 * into its feed. */
export function summarizeAgentEvents(events: NormalizedEvent[], maxSteps = 24): AgentStats {
  const toolCounts = new Map<string, number>();
  const resultByToolUseId = new Map<string, boolean>(); // toolUseId -> isError
  let thinkingCount = 0;
  let fileEditCount = 0;
  let spawnCount = 0;
  let messageCount = 0;
  let errorCount = 0;
  const steps: Step[] = [];

  for (const event of events) {
    switch (event.kind) {
      case "thinking":
        thinkingCount++;
        steps.push({ id: event.id, kind: "thinking", timestamp: event.timestamp });
        break;
      case "tool_call":
        toolCounts.set(event.name, (toolCounts.get(event.name) ?? 0) + 1);
        steps.push({ id: event.id, kind: "tool_call", timestamp: event.timestamp, toolName: event.name });
        break;
      case "tool_result":
        resultByToolUseId.set(event.toolUseId, event.isError);
        if (event.isError) errorCount++;
        break;
      case "file_edit":
        fileEditCount++;
        steps.push({ id: event.id, kind: "file_edit", timestamp: event.timestamp });
        break;
      case "agent_spawn":
        spawnCount++;
        steps.push({ id: event.id, kind: "agent_spawn", timestamp: event.timestamp });
        break;
      case "agent_message":
        messageCount++;
        steps.push({ id: event.id, kind: "agent_message", timestamp: event.timestamp });
        break;
    }
  }

  // Back-fill error flags onto tool_call steps now that all tool_results
  // have been seen (a result can arrive after its call in event order).
  const toolCallEvents = events.filter((e): e is Extract<NormalizedEvent, { kind: "tool_call" }> => e.kind === "tool_call");
  const errorFlagById = new Map<string, boolean>();
  for (const e of toolCallEvents) {
    const isError = resultByToolUseId.get(e.toolUseId);
    if (isError) errorFlagById.set(e.id, true);
  }
  for (const step of steps) {
    if (step.kind === "tool_call" && errorFlagById.get(step.id)) step.isError = true;
  }

  const trimmedSteps = steps.length > maxSteps ? steps.slice(steps.length - maxSteps) : steps;

  return {
    totalEvents: events.length,
    thinkingCount,
    toolCounts: [...toolCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    totalToolCalls: toolCallEvents.length,
    fileEditCount,
    spawnCount,
    messageCount,
    errorCount,
    firstTimestamp: events[0]?.timestamp,
    lastTimestamp: events[events.length - 1]?.timestamp,
    steps: trimmedSteps,
  };
}

export const STEP_GLYPH: Record<StepKind, string> = {
  thinking: "\u{1F4AD}", // 💭
  tool_call: "\u{1F527}", // 🔧
  file_edit: "\u{1F4DD}", // 📝
  agent_spawn: "\u{1F9E9}", // 🧩
  agent_message: "✉️", // ✉️
};

export const STEP_COLOR: Record<StepKind, string> = {
  thinking: "var(--status-thinking)",
  tool_call: "var(--status-tool)",
  file_edit: "var(--status-done)",
  agent_spawn: "#f59e0b",
  agent_message: "#ec4899",
};

