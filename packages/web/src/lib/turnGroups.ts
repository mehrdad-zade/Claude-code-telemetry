import {
  ZERO_USAGE,
  addUsage,
  totalTokens,
  validateTurns,
  findPlans,
  isPlanModePrompt,
  type AgentNode,
  type PlanInfo,
  type NormalizedEvent,
  type TokenUsage,
  type ToolResultEvent,
  type TurnValidation,
} from "@agent-tel/shared";
import { splitIntoTurns, summarizeTurn, type TurnSummary } from "./turns.js";
import { buildActivityBreakdown, type ActivityCategory } from "./activity.js";
import { agentLabel } from "./agentColor.js";

export interface ModelUsage {
  model: string;
  usage: TokenUsage;
}

/** A token total plus its per-model split (largest first). */
export interface TokenBreakdown {
  total: TokenUsage;
  byModel: ModelUsage[];
}

export interface TurnTokens {
  /** Rough size of the prompt text itself (~chars/4). Its real cost is
   * billed inside the first API call's input, which Activity/Response
   * already include — so this is informational, not part of `total`. */
  instructionApprox: number;
  activity: TokenBreakdown;
  response: TokenBreakdown;
  total: TokenBreakdown;
}

/** Everything one agent did within one turn — one Activity box. */
export interface AgentActivity {
  agentId: string;
  label: string;
  isMain: boolean;
  firstEventId?: string;
  categories: ActivityCategory[];
  tokens: TokenBreakdown;
}

/** One instruction/response cycle, with everything the Visualization
 * section needs to render its Instruction → Activity (one box per agent) →
 * Response row. */
export interface TurnRow {
  key: string;
  index: number;
  timestamp: string;
  promptText?: string;
  promptEventId?: string;
  firstEventId?: string;
  lastAssistantEventId?: string;
  summary: TurnSummary;
  /** Main agent first, then sub-agents in the order they started. */
  agents: AgentActivity[];
  tokens: TurnTokens;
  /** Heuristic estimate of whether the instruction was fulfilled. */
  validation: TurnValidation;
  /** The prompt was sent in Claude Code's plan mode. */
  planMode: boolean;
  /** The plan presented in this turn — the approved one if there are several. */
  plan?: PlanInfo;
}

class BreakdownBuilder {
  private total = ZERO_USAGE;
  private models = new Map<string, TokenUsage>();

  add(model: string, usage: TokenUsage): this {
    this.total = addUsage(this.total, usage);
    this.models.set(model, addUsage(this.models.get(model) ?? ZERO_USAGE, usage));
    return this;
  }

  build(): TokenBreakdown {
    const byModel = [...this.models.entries()]
      .map(([model, usage]) => ({ model, usage }))
      .filter((m) => totalTokens(m.usage) > 0)
      .sort((a, b) => totalTokens(b.usage) - totalTokens(a.usage));
    return { total: this.total, byModel };
  }
}

/** Splits a turn's API-message usage between the Response box (the message
 * that produced the final assistant text) and the Activity box (every
 * other message), each broken down by model. Usage is deduped by
 * messageId, since one message spans several transcript lines. */
function turnTokens(events: NormalizedEvent[], promptText: string | undefined, responseMessageId: string | undefined): TurnTokens {
  const byMessage = new Map<string, { usage: TokenUsage; model: string }>();
  events.forEach((e, i) => {
    if (e.usage) byMessage.set(e.messageId ?? `${e.id}:${i}`, { usage: e.usage, model: e.model ?? "unknown model" });
  });

  const activity = new BreakdownBuilder();
  const response = new BreakdownBuilder();
  const total = new BreakdownBuilder();
  for (const [messageId, { usage, model }] of byMessage) {
    (messageId === responseMessageId ? response : activity).add(model, usage);
    total.add(model, usage);
  }

  return {
    instructionApprox: promptText ? Math.ceil(promptText.length / 4) : 0,
    activity: activity.build(),
    response: response.build(),
    total: total.build(),
  };
}

function mergeBreakdowns(parts: TokenBreakdown[]): TokenBreakdown {
  const b = new BreakdownBuilder();
  for (const part of parts) for (const m of part.byModel) b.add(m.model, m.usage);
  return b.build();
}

/** Builds one row per main-agent turn. Sub-agent events (any agent other
 * than `mainAgentId`) are attributed to the main turn whose time window
 * contains them — that covers agents spawned in the turn, agents resumed
 * later via SendMessage, and nested sub-agents alike. */
export function buildTurnRows(events: NormalizedEvent[], mainAgentId: string, agents: AgentNode[]): TurnRow[] {
  const results = new Map<string, ToolResultEvent>();
  for (const e of events) if (e.kind === "tool_result") results.set(e.toolUseId, e);

  const turns = splitIntoTurns(events.filter((e) => e.agentId === mainAgentId));
  const starts = turns.map((t) => t.timestamp);

  // turn index -> agentId -> that agent's events within the turn
  const subByTurn = turns.map(() => new Map<string, NormalizedEvent[]>());
  for (const e of events) {
    if (e.agentId === mainAgentId || turns.length === 0) continue;
    let idx = 0;
    while (idx + 1 < starts.length && starts[idx + 1] && e.timestamp >= starts[idx + 1]) idx++;
    const bucket = subByTurn[idx];
    if (!bucket.has(e.agentId)) bucket.set(e.agentId, []);
    bucket.get(e.agentId)!.push(e);
  }

  const agentById = new Map(agents.map((a) => [a.agentId, a]));
  const nameFor = (agentId: string) => {
    const agent = agentById.get(agentId);
    return agent ? agentLabel(agent) : `sub-agent ${agentId.slice(0, 8)}`;
  };

  const byTime = (a: NormalizedEvent, b: NormalizedEvent) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);
  const turnEvents = turns.map((turn, index) => [...turn.events, ...[...subByTurn[index].values()].flat()].sort(byTime));
  // Same scoring as the server's sidebar stats (shared validateTurns).
  const validations = validateTurns(turns.map((turn, index) => ({ prompt: turn.prompt, events: turnEvents[index] })));
  const turnPlans = turnEvents.map((events) => {
    const plans = findPlans(events);
    return [...plans].reverse().find((p) => p.status === "approved") ?? plans[plans.length - 1];
  });

  return turns.map((turn, index) => {
    const lastAssistantEvent = [...turn.events].reverse().find((e) => e.kind === "text" && !e.isHumanPrompt);
    const mainTokens = turnTokens(turn.events, turn.prompt?.text, lastAssistantEvent?.messageId);

    const subAgents: AgentActivity[] = [...subByTurn[index].entries()].map(([agentId, agentEvents]) => ({
      agentId,
      label: nameFor(agentId),
      isMain: false,
      firstEventId: agentEvents[0]?.id,
      categories: buildActivityBreakdown(agentEvents, results),
      tokens: turnTokens(agentEvents, undefined, undefined).total,
    }));

    const main: AgentActivity = {
      agentId: mainAgentId,
      label: "Main agent",
      isMain: true,
      firstEventId: turn.prompt?.id ?? turn.events[0]?.id,
      categories: buildActivityBreakdown(turn.events, results),
      tokens: mainTokens.activity,
    };

    const activity = mergeBreakdowns([mainTokens.activity, ...subAgents.map((a) => a.tokens)]);
    const validation = validations[index];
    return {
      key: turn.key,
      index,
      timestamp: turn.timestamp,
      promptText: turn.prompt?.text,
      promptEventId: turn.prompt?.id,
      firstEventId: turn.prompt?.id ?? turn.events[0]?.id,
      lastAssistantEventId: lastAssistantEvent?.id,
      summary: summarizeTurn(turn.events),
      agents: [main, ...subAgents],
      tokens: {
        instructionApprox: mainTokens.instructionApprox,
        activity,
        response: mainTokens.response,
        total: mergeBreakdowns([activity, mainTokens.response]),
      },
      validation,
      planMode: isPlanModePrompt(turn.prompt),
      plan: turnPlans[index],
    };
  });
}
