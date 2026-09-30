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
