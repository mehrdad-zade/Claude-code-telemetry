// Normalized data model shared between the server and the web client.
// The server's `normalize/normalizer.ts` is the ONLY place that knows the raw
// on-disk Claude Code JSONL shape; everything downstream (including the whole
// frontend) only ever sees the types in this file.

export type AgentRole = "main" | "subagent";

export type AgentStatus =
  | "thinking"
  | "tool_running"
  | "idle"
  | "done"
  | "unknown";

export interface AgentNode {
  /** sessionId for a main session, agentId (hex) for a sub-agent. */
  agentId: string;
  parentAgentId: string | null;
  role: AgentRole;
  /** Top-level session this agent belongs to (== agentId for main agents). */
  sessionId: string;
  cwd: string;
  /** tool_use.id in the parent that spawned this agent, if role === "subagent". */
  spawnedByToolUseId: string | null;
  subagentType?: string;
  description?: string;
  /** Friendly session name / last known ai-title, for display. */
  title?: string;
  lastPrompt?: string;
  createdAt: string;
  status: AgentStatus;
  lastActivityAt: string;
}

export interface LiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  name: string;
  status: string;
  startedAt: number;
  updatedAt: number;
}

export interface ProjectHistoryEntry {
  /** Encoded project directory name under ~/.claude/projects */
  encodedCwd: string;
  cwd: string;
  sessionId: string;
  title?: string;
  lastPrompt?: string;
  mtimeMs: number;
  /** True if this session currently has a live pid tracked in the registry. */
  isLive: boolean;
  /** Main agent + every sub-agent transcript found for this session. */
  agentCount: number;
}

export interface DiffHunk {
  /** Unified-diff-style text for this hunk, as produced by the `diff` package. */
  text: string;
  added: number;
  removed: number;
}

export type NormalizedEvent =
  | ThinkingEvent
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | FileEditEvent
  | AgentSpawnEdge
  | AgentMessageEdge
  | SessionLifecycleEvent
  | RawPassthroughEvent
  | AgentSpawnPendingEvent;

interface BaseEvent {
  id: string;
  agentId: string;
  sessionId: string;
  timestamp: string;
  /** Monotonic per-agent ordering (line index within that agent's own file). */
  seq: number;
  /** API message id this event came from (assistant events only). One API
   * message is split across several transcript lines, so consumers dedupe
   * `usage` by this id. */
  messageId?: string;
  /** Token usage of that API message — set only on the FIRST event emitted
   * from each assistant line, so summing per-event never multi-counts a line. */
  usage?: TokenUsage;
  /** Model that produced that API message (e.g. "claude-opus-5-5"); set
   * alongside `usage`. */
  model?: string;
}

export interface ThinkingEvent extends BaseEvent {
  kind: "thinking";
  text: string;
}

export interface TextEvent extends BaseEvent {
  kind: "text";
  text: string;
  isHumanPrompt: boolean;
}

export interface ToolCallEvent extends BaseEvent {
  kind: "tool_call";
  toolUseId: string;
  name: string;
  input: unknown;
}

export interface ToolResultEvent extends BaseEvent {
  kind: "tool_result";
  toolUseId: string;
  content: unknown;
  isError: boolean;
}

export interface FileEditEvent extends BaseEvent {
  kind: "file_edit";
  toolUseId: string;
  path: string;
  diffHunks: DiffHunk[];
}

export interface AgentSpawnEdge extends BaseEvent {
  kind: "agent_spawn";
  parentAgentId: string;
  childAgentId: string;
  toolUseId: string;
  subagentType?: string;
  description?: string;
}

export interface AgentMessageEdge extends BaseEvent {
  kind: "agent_message";
  fromAgentId: string;
  toAgentId: string;
  toolUseId: string;
  preview: string;
}

export interface SessionLifecycleEvent extends BaseEvent {
  kind: "lifecycle";
  state: "live" | "ended";
}

export interface RawPassthroughEvent extends BaseEvent {
  kind: "raw";
  rawType: string;
  raw: unknown;
}

/** A lightweight marker the parent node uses to show a transient "spawning..." state
 * before the tool_result confirming the child agentId has arrived. */
export interface AgentSpawnPendingEvent extends BaseEvent {
  kind: "agent_spawn_pending";
  parentAgentId: string;
  toolUseId: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

/** The "tokens used" number shown everywhere in the UI: input + output +
 * cache writes. Cache reads are deliberately excluded — they're cheap and
 * typically 90%+ of raw volume, which would swamp everything else. */
export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheWrite;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

export interface PlanWindow {
  /** 0-100 */
  percent: number;
  resetsAt?: string;
  /** Short description of which plan window this is, e.g. "5h session". */
  label: string;
  /** Extra detail, e.g. "CA$0.00 / CA$30.00". */
  detail?: string;
}

/** Plan-limit utilization as last seen by Claude Code's own `/status` (read
 * from its local cache, never fetched by agent-tel). */
export interface PlanLimits {
  fetchedAtMs: number;
  session?: PlanWindow;
  weekly?: PlanWindow;
  monthly?: PlanWindow;
}

export interface UsageSummary {
  today: TokenUsage;
  week: TokenUsage;
  month: TokenUsage;
  plan: PlanLimits | null;
}
