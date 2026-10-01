import type { NormalizedEvent } from "@agent-tel/shared";

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
}

/** Aggregates ALL of one agent's events (not just one turn) into the summary
 * shown in its detail panel and as a one-line gist on its graph box — tool
 * usage, counts, and a time span. The step-by-step sequence itself is
 * handled separately by lib/journey.ts, which drives the clickable journey
 * timeline. */
export function summarizeAgentEvents(events: NormalizedEvent[]): AgentStats {
  const toolCounts = new Map<string, number>();
  let thinkingCount = 0;
  let fileEditCount = 0;
  let spawnCount = 0;
  let messageCount = 0;
  let errorCount = 0;

  for (const event of events) {
    switch (event.kind) {
      case "thinking":
        thinkingCount++;
        break;
      case "tool_call":
        toolCounts.set(event.name, (toolCounts.get(event.name) ?? 0) + 1);
        break;
      case "tool_result":
        if (event.isError) errorCount++;
        break;
      case "file_edit":
        fileEditCount++;
        break;
      case "agent_spawn":
        spawnCount++;
        break;
      case "agent_message":
        messageCount++;
        break;
    }
  }

  const totalToolCalls = events.filter((e) => e.kind === "tool_call").length;

  return {
    totalEvents: events.length,
    thinkingCount,
    toolCounts: [...toolCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    totalToolCalls,
    fileEditCount,
    spawnCount,
    messageCount,
    errorCount,
    firstTimestamp: events[0]?.timestamp,
    lastTimestamp: events[events.length - 1]?.timestamp,
  };
}
