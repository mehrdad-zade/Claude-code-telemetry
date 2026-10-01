import type { NormalizedEvent } from "@agent-tel/shared";
import { splitIntoTurns, summarizeTurn, type TurnSummary } from "./turns.js";
import { buildJourney, type JourneyStep } from "./journey.js";

export interface HandoffRef {
  id: string;
  targetAgentId: string;
  label: string;
}

/** One instruction/response cycle, with everything both the Visualization
 * section (grouped Instruction → Activity → Response boxes) and the Journey
 * section (granular step chips) need to render their own row for it — the
 * two sections show the same turns at different levels of detail, so they
 * share this one data source. */
export interface TurnRow {
  key: string;
  index: number;
  timestamp: string;
  promptText?: string;
  promptEventId?: string;
  firstEventId?: string;
  lastAssistantEventId?: string;
  summary: TurnSummary;
  steps: JourneyStep[];
  spawns: HandoffRef[];
  messages: HandoffRef[];
}

export function buildTurnRows(events: NormalizedEvent[]): TurnRow[] {
  const turns = splitIntoTurns(events);
  const journey = buildJourney(events);

  const stepsByTurn = new Map<number, JourneyStep[]>();
  for (const step of journey.steps) {
    const list = stepsByTurn.get(step.turnIndex);
    if (list) list.push(step);
    else stepsByTurn.set(step.turnIndex, [step]);
  }

  return turns.map((turn, index) => {
    const lastAssistantEvent = [...turn.events].reverse().find((e) => e.kind === "text" && !e.isHumanPrompt);
    const spawns: HandoffRef[] = turn.events
      .filter((e): e is Extract<NormalizedEvent, { kind: "agent_spawn" }> => e.kind === "agent_spawn")
      .map((e) => ({ id: e.id, targetAgentId: e.childAgentId, label: e.subagentType ?? "sub-agent" }));
    const messages: HandoffRef[] = turn.events
      .filter((e): e is Extract<NormalizedEvent, { kind: "agent_message" }> => e.kind === "agent_message")
      .map((e) => ({ id: e.id, targetAgentId: e.toAgentId, label: e.preview }));

    return {
      key: turn.key,
      index,
      timestamp: turn.timestamp,
      promptText: turn.prompt?.text,
      promptEventId: turn.prompt?.id,
      firstEventId: turn.prompt?.id ?? turn.events[0]?.id,
      lastAssistantEventId: lastAssistantEvent?.id,
      summary: summarizeTurn(turn.events),
      steps: stepsByTurn.get(index) ?? [],
      spawns,
      messages,
    };
  });
}
