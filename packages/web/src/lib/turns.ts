import type { NormalizedEvent, TextEvent } from "@agent-tel/shared";

export interface Turn {
  key: string;
  prompt?: TextEvent;
  events: NormalizedEvent[];
  timestamp: string;
}

/** Splits one agent's flat event list into "turns" — everything that happens
 * between one human prompt and the next. This is what lets the feed show a
 * compact, scannable list instead of one unbroken scroll: each turn collapses
 * to a one-line summary by default. Events before the first prompt (common
 * for a sub-agent, whose very first line usually isn't flagged as a human
 * prompt) land in a single leading turn. */
export function splitIntoTurns(events: NormalizedEvent[]): Turn[] {
  const turns: Turn[] = [];
  let current: NormalizedEvent[] = [];
  let currentPrompt: TextEvent | undefined;
  let currentTimestamp: string | undefined;

  function pushCurrent() {
    if (current.length === 0 && !currentPrompt) return;
    turns.push({
      key: currentPrompt?.id ?? current[0]?.id ?? `turn-${turns.length}`,
      prompt: currentPrompt,
      events: current,
      timestamp: currentTimestamp ?? currentPrompt?.timestamp ?? current[0]?.timestamp ?? "",
    });
  }

  for (const event of events) {
    if (event.kind === "text" && event.isHumanPrompt) {
      pushCurrent();
      currentPrompt = event;
      currentTimestamp = event.timestamp;
      current = [];
      continue;
    }
    if (!currentTimestamp) currentTimestamp = event.timestamp;
    current.push(event);
  }
  pushCurrent();
  return turns;
}

export interface TurnSummary {
  thinkingCount: number;
  toolCounts: Array<{ name: string; count: number }>;
  fileEditCount: number;
  hasError: boolean;
  lastAssistantText?: string;
  spawnCount: number;
}

export function summarizeTurn(events: NormalizedEvent[]): TurnSummary {
  let thinkingCount = 0;
  const toolCounts = new Map<string, number>();
  let fileEditCount = 0;
  let hasError = false;
  let lastAssistantText: string | undefined;
  let spawnCount = 0;

  for (const event of events) {
    switch (event.kind) {
      case "thinking":
        thinkingCount++;
        break;
      case "tool_call":
        toolCounts.set(event.name, (toolCounts.get(event.name) ?? 0) + 1);
        break;
      case "tool_result":
        if (event.isError) hasError = true;
        break;
      case "file_edit":
        fileEditCount++;
        break;
      case "text":
        if (!event.isHumanPrompt) lastAssistantText = event.text;
        break;
      case "agent_spawn":
        spawnCount++;
        break;
    }
  }

  return {
    thinkingCount,
    toolCounts: [...toolCounts.entries()].map(([name, count]) => ({ name, count })),
    fileEditCount,
    hasError,
    lastAssistantText,
    spawnCount,
  };
}
