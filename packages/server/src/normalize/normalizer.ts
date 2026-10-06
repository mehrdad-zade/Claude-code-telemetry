import { z } from "zod";
import { createPatch } from "diff";
import type { DiffHunk, NormalizedEvent, TokenUsage } from "@agent-tel/shared";
import { logger } from "../logger.js";

export interface NormalizeContext {
  sessionId: string;
  /** sessionId for the main agent, agentId (hex) for a sub-agent. */
  agentId: string;
  /** Monotonic index of this line within this agent's own transcript file. */
  seq: number;
}

interface PendingToolCall {
  name: string;
  input: unknown;
  agentId: string;
}

const SPAWN_TOOL_NAMES = new Set(["Agent", "Task"]);
const MESSAGE_TOOL_NAMES = new Set(["SendMessage"]);

// Deliberately loose: every field but `type` is optional/unknown so a future
// Claude Code schema change degrades to a RawPassthroughEvent instead of
// throwing. This file is the ONLY place that knows the raw JSONL shape.
const RawLineSchema = z
  .object({
    type: z.string().optional(),
    uuid: z.string().optional(),
    timestamp: z.string().optional(),
    origin: z.object({ kind: z.string().optional() }).passthrough().optional(),
    permissionMode: z.string().optional(),
    message: z
      .object({
        id: z.string().optional(),
        model: z.string().optional(),
        role: z.string().optional(),
        content: z.unknown().optional(),
        usage: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === "object" && "text" in block ? String((block as any).text) : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Extracts `agentId: <hex>` out of the Agent tool's tool_result text, which
 * is currently the only place the spawned child's id shows up. */
function extractSpawnedAgentId(resultText: string): string | null {
  const match = resultText.match(/agentId:\s*([a-f0-9]{6,})/i);
  return match ? match[1] : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Maps the raw API `usage` object to our TokenUsage, or undefined if absent. */
export function toTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
    cacheRead: num(u.cache_read_input_tokens),
  };
}

function buildDiffHunks(filePath: string, before: string, after: string): DiffHunk[] {
  const patch = createPatch(filePath, before, after, "", "", { context: 3 });
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return [{ text: patch, added, removed }];
}

/** Turns raw Claude Code JSONL lines into the stable NormalizedEvent model.
 * One instance is shared across a whole session's agent tree (main +
 * sub-agents) so it can pair a tool_use in one line with its tool_result in
 * a later line via toolUseId, regardless of which agent's file each is in. */
export class Normalizer {
  private pendingToolCalls = new Map<string, PendingToolCall>();

  normalizeLine(raw: unknown, ctx: NormalizeContext): NormalizedEvent[] {
    const parsed = RawLineSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.type) {
      return [this.passthrough(raw, ctx, "unparsed")];
    }
    const line = parsed.data;
    const timestamp = line.timestamp ?? new Date().toISOString();

    try {
      switch (line.type) {
        case "assistant":
          return this.normalizeAssistant(line, ctx, timestamp);
        case "user":
          return this.normalizeUser(line, ctx, timestamp);
        case "system": {
          // Not modeled as its own event kind in v1 — surfaced as a tagged
          // passthrough (`system:turn_duration`, `system:local_command`, ...)
          // so the UI/agentTree can still special-case the ones it cares
          // about without every system subtype needing a first-class type.
          const subtype = (raw as { subtype?: string }).subtype ?? "unknown";
          return [this.passthrough(raw, ctx, `system:${subtype}`, timestamp)];
        }
        default:
          return [this.passthrough(raw, ctx, line.type ?? "unknown", timestamp)];
      }
    } catch (err) {
      // A shape we didn't anticipate inside a known `type` — never let one
      // bad line take down the whole tailer.
      logger.warn("normalizer failed on line, passing through raw", line.type, err);
      return [this.passthrough(raw, ctx, line.type ?? "unknown", timestamp)];
    }
  }

  private base(ctx: NormalizeContext, timestamp: string, idx: number) {
    return {
      id: `${ctx.agentId}:${ctx.seq}:${idx}`,
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      timestamp,
      seq: ctx.seq,
    };
  }

  private passthrough(raw: unknown, ctx: NormalizeContext, rawType: string, timestamp?: string): NormalizedEvent {
    return {
      ...this.base(ctx, timestamp ?? new Date().toISOString(), 0),
      kind: "raw",
      rawType,
      raw,
    };
  }

  private normalizeAssistant(
    line: z.infer<typeof RawLineSchema>,
    ctx: NormalizeContext,
    timestamp: string
  ): NormalizedEvent[] {
    const content = line.message?.content;
    if (!Array.isArray(content)) return [];

    const events: NormalizedEvent[] = [];
    content.forEach((block: any, idx: number) => {
      if (!block || typeof block !== "object") return;
      const base = this.base(ctx, timestamp, idx);

      switch (block.type) {
        case "thinking": {
          // Always emit this — some reasoning-effort/model configurations
          // write a thinking block with an empty `thinking` string (just a
          // verification signature, no readable summary). Dropping those
          // would silently undercount how much an agent actually thought,
          // which defeats the point of the process view. The UI shows a
          // placeholder for the empty-text case instead of a blank block.
          const text = String(block.thinking ?? "");
          events.push({ ...base, kind: "thinking", text });
          break;
        }
        case "text": {
          const text = String(block.text ?? "");
          if (text) events.push({ ...base, kind: "text", text, isHumanPrompt: false });
          break;
        }
        case "tool_use": {
          const toolUseId = String(block.id ?? `${base.id}:tool`);
          const name = String(block.name ?? "unknown_tool");
          this.pendingToolCalls.set(toolUseId, { name, input: block.input, agentId: ctx.agentId });
          events.push({ ...base, kind: "tool_call", toolUseId, name, input: block.input });

          if (SPAWN_TOOL_NAMES.has(name)) {
            // Shares the same source block as the tool_call above — give it
            // its own id (a shared id would collide as a React key / in the
            // client's event-id dedup, silently dropping one of the two).
            events.push({ ...base, id: `${base.id}:spawn_pending`, kind: "agent_spawn_pending", parentAgentId: ctx.agentId, toolUseId });
          } else if (MESSAGE_TOOL_NAMES.has(name) && block.input?.to) {
            events.push({
              ...base,
              id: `${base.id}:message`,
              kind: "agent_message",
              fromAgentId: ctx.agentId,
              toAgentId: String(block.input.to),
              toolUseId,
              preview: truncate(String(block.input.message ?? block.input.summary ?? ""), 140),
            });
          }
          break;
        }
        default:
          events.push({ ...base, kind: "raw", rawType: `content:${block.type}`, raw: block });
      }
    });

    // messageId on every event (so the UI can tell which API message a block
    // belongs to); usage + model only on the first, so per-event sums never
    // multi-count one line.
    const messageId = line.message?.id;
    const usage = toTokenUsage(line.message?.usage);
    const model = line.message?.model;
    return events.map((event, i) => ({
      ...event,
      ...(messageId ? { messageId } : {}),
      ...(i === 0 && usage ? { usage, ...(model ? { model } : {}) } : {}),
    }));
  }

  private normalizeUser(
    line: z.infer<typeof RawLineSchema>,
    ctx: NormalizeContext,
    timestamp: string
  ): NormalizedEvent[] {
    const content = line.message?.content;
    const base = this.base(ctx, timestamp, 0);

    if (typeof content === "string") {
      if (!content) return [];
      const isHumanPrompt = line.origin?.kind === "human";
      const permissionMode = isHumanPrompt ? line.permissionMode : undefined;
      return [{ ...base, kind: "text", text: content, isHumanPrompt, ...(permissionMode ? { permissionMode } : {}) }];
    }

    if (!Array.isArray(content)) return [];

    const events: NormalizedEvent[] = [];
    content.forEach((block: any, idx: number) => {
      if (!block || typeof block !== "object" || block.type !== "tool_result") return;

      const eventBase = this.base(ctx, timestamp, idx);
      const toolUseId = String(block.tool_use_id ?? "");
      const isError = Boolean(block.is_error);
      events.push({ ...eventBase, kind: "tool_result", toolUseId, content: block.content, isError });

      const pending = this.pendingToolCalls.get(toolUseId);
      this.pendingToolCalls.delete(toolUseId);
      if (!pending) return;

      if (SPAWN_TOOL_NAMES.has(pending.name)) {
        const resultText = extractText(block.content);
        const childAgentId = extractSpawnedAgentId(resultText);
        if (childAgentId) {
          const input = pending.input as { subagent_type?: string; description?: string } | undefined;
          events.push({
            ...eventBase,
            // Shares the tool_result's source block — see the matching note
            // in normalizeAssistant for why this needs its own id.
            id: `${eventBase.id}:spawn_resolved`,
            kind: "agent_spawn",
            parentAgentId: pending.agentId,
            childAgentId,
            toolUseId,
            subagentType: input?.subagent_type,
            description: input?.description,
          });
        }
        return;
      }

      if (!isError && (pending.name === "Edit" || pending.name === "Write")) {
        const input = pending.input as
          | { file_path?: string; old_string?: string; new_string?: string; content?: string }
          | undefined;
        if (input?.file_path) {
          const before = input.old_string ?? "";
          const after = input.new_string ?? input.content ?? "";
          events.push({
            ...eventBase,
            id: `${eventBase.id}:file_edit`,
            kind: "file_edit",
            toolUseId,
            path: input.file_path,
            diffHunks: buildDiffHunks(input.file_path, before, after),
          });
        }
      }
    });
    return events;
  }
}
