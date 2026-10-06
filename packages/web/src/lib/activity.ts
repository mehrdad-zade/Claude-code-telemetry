import type { NormalizedEvent, ToolCallEvent, ToolResultEvent } from "@agent-tel/shared";
import { reasoningSteps } from "./reasoning.js";

export interface ActivityItem {
  eventId: string;
  label: string;
  isError?: boolean;
}

/** One line of the Activity breakdown (e.g. "🔧 Bash ×12"), with every
 * underlying event so each one can be opened in the log. */
export interface ActivityCategory {
  key: string;
  icon: string;
  label: string;
  count: number;
  items: ActivityItem[];
  isError?: boolean;
}

/** "mcp__claude-in-chrome__computer" → "chrome: computer"; built-in tool
 * names pass through unchanged. */
function shortToolName(name: string): string {
  const match = name.match(/^mcp__(.+?)__(.+)$/);
  if (!match) return name;
  const server = match[1].replace(/^claude[-_]in[-_]|^claude_ai_/i, "");
  return `${server}: ${match[2]}`;
}

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

function oneLine(text: string, max = 80): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

/** Short, human description of what a tool call did — the bit you'd want to
 * see in a list ("npm test", "App.tsx", "TODO pattern") instead of raw JSON. */
export function toolCallLabel(call: Pick<ToolCallEvent, "name" | "input">): string {
  const input = (call.input && typeof call.input === "object" ? call.input : {}) as Record<string, unknown>;
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : undefined);

  switch (call.name) {
    case "Bash":
      return oneLine(str("description") ?? str("command") ?? "");
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit": {
      const path = str("file_path") ?? str("notebook_path");
      return path ? basename(path) : "";
    }
    case "Grep":
    case "Glob":
      return oneLine(str("pattern") ?? "");
    case "WebFetch":
      return oneLine(str("url") ?? "");
    case "WebSearch":
      return oneLine(str("query") ?? "");
    case "Agent":
    case "Task":
      return oneLine(str("description") ?? str("subagent_type") ?? "");
    case "Skill":
      return oneLine(str("skill") ?? "");
  }
  const firstString = Object.values(input).find((v): v is string => typeof v === "string" && v.length > 0);
  return firstString ? oneLine(firstString) : "";
}

/** Every kind of thing an agent did in a set of events, grouped into
 * categories, in a stable order: reasoning (thinking + narration), each tool (most-used
 * first), file edits, errors, hand-offs, then anything else. */
export function buildActivityBreakdown(
  events: NormalizedEvent[],
  results: Map<string, ToolResultEvent>
): ActivityCategory[] {
  const reasoning: ActivityItem[] = reasoningSteps(events).map((step) => ({
    eventId: step.id,
    label: step.texts.length > 0 ? oneLine(step.texts.map((t) => t.text).join(" ")) : "(thinking text not recorded)",
  }));
  const tools = new Map<string, ActivityItem[]>();
  const edits = new Map<string, { eventId: string; added: number; removed: number; count: number }>();
  const errors: ActivityItem[] = [];
  const spawns: ActivityItem[] = [];
  const messages: ActivityItem[] = [];
  const other = new Map<string, ActivityItem[]>();

  for (const e of events) {
    switch (e.kind) {
      case "tool_call": {
        const result = results.get(e.toolUseId);
        const item = { eventId: e.id, label: toolCallLabel(e) || e.name, isError: result?.isError };
        if (!tools.has(e.name)) tools.set(e.name, []);
        tools.get(e.name)!.push(item);
        if (result?.isError) errors.push({ eventId: e.id, label: `${e.name}: ${item.label}`, isError: true });
        break;
      }
      case "file_edit": {
        const added = e.diffHunks.reduce((n, h) => n + h.added, 0);
        const removed = e.diffHunks.reduce((n, h) => n + h.removed, 0);
        const prev = edits.get(e.path);
        edits.set(e.path, {
          eventId: prev?.eventId ?? e.id,
          added: (prev?.added ?? 0) + added,
          removed: (prev?.removed ?? 0) + removed,
          count: (prev?.count ?? 0) + 1,
        });
        break;
      }
      case "agent_spawn":
        spawns.push({ eventId: e.id, label: [e.subagentType, e.description].filter(Boolean).join(" — ") || "sub-agent" });
        break;
      case "agent_message":
        messages.push({ eventId: e.id, label: `→ ${e.toAgentId.slice(0, 8)}: ${oneLine(e.preview, 60)}` });
        break;
      case "raw":
        if (!e.rawType.startsWith("system:")) {
          if (!other.has(e.rawType)) other.set(e.rawType, []);
          other.get(e.rawType)!.push({ eventId: e.id, label: e.rawType });
        }
        break;
    }
  }

  const categories: ActivityCategory[] = [];
  const add = (key: string, icon: string, label: string, items: ActivityItem[], isError = false) => {
    if (items.length > 0) categories.push({ key, icon, label, count: items.length, items, isError });
  };

  add("reasoning", "💭", "Reasoning", reasoning);
  for (const [name, items] of [...tools.entries()].sort((a, b) => b[1].length - a[1].length)) {
    add(`tool:${name}`, "🔧", shortToolName(name), items);
  }
  add(
    "edits",
    "📝",
    "Files edited",
    [...edits.entries()].map(([path, v]) => ({
      eventId: v.eventId,
      label: `${basename(path)}  +${v.added} −${v.removed}${v.count > 1 ? ` (${v.count} edits)` : ""}`,
    }))
  );
  add("errors", "⚠️", "Errors", errors, true);
  add("spawns", "🧩", "Sub-agents spawned", spawns);
  add("messages", "✉️", "Messages sent", messages);
  for (const [rawType, items] of other) {
    add(`raw:${rawType}`, rawType === "attachment" ? "📎" : "•", rawType === "attachment" ? "Context attachments" : rawType, items);
  }

  return categories;
}
