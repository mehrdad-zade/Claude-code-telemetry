import { useState } from "react";
import type { ToolCallEvent } from "@agent-tel/shared";
import { Markdown } from "./Markdown.js";

type Input = Record<string, any>;

function asInput(value: unknown): Input {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Input) : {};
}

/** "mcp__claude-in-chrome__computer" → { server: "claude-in-chrome", tool: "computer" }. */
export function splitMcpName(name: string): { server: string; tool: string } | null {
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  return m ? { server: m[1], tool: m[2] } : null;
}

function isBrowserServer(server: string): boolean {
  return /chrome|browser/i.test(server);
}

/** One line for a browser-automation step: "left_click (85, 96) — Opens the live session". */
export function describeBrowserAction(tool: string, input: Input): string {
  const coord = Array.isArray(input.coordinate) ? ` (${input.coordinate.join(", ")})` : "";
  const why = input.action_summary ? ` — ${input.action_summary}` : "";
  switch (tool) {
    case "computer": {
      const action = String(input.action ?? "action");
      if (action === "type") return `type “${String(input.text ?? "")}”${why}`;
      if (action === "key") return `key ${String(input.text ?? "")}${why}`;
      if (action === "wait") return `wait ${input.duration ?? "?"}s`;
      if (action === "scroll") return `scroll ${input.scroll_direction ?? ""}${coord}`;
      if (action === "zoom" && Array.isArray(input.region)) return `zoom [${input.region.join(", ")}]`;
      return `${action}${coord}${input.ref ? ` ${input.ref}` : ""}${why}`;
    }
    case "navigate":
      return `navigate ${String(input.url ?? "")}`;
    case "find":
      return `find “${String(input.query ?? "")}”`;
    case "form_input":
      return `fill ${String(input.ref ?? "")}${why}`;
    case "read_console_messages":
      return `read console${input.pattern ? ` /${input.pattern}/` : ""}`;
    case "read_network_requests":
      return "read network requests";
    case "get_page_text":
      return "read page text";
    case "read_page":
      return `read page${input.filter ? ` (${input.filter})` : ""}`;
    case "tabs_create_mcp":
      return "open new tab";
    case "tabs_close_mcp":
      return `close tab ${input.tabId ?? ""}`;
    case "tabs_context_mcp":
      return "list tabs";
    case "javascript_tool":
      return "run JavaScript";
  }
  return tool;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tool-field">
      <span className="tool-field-label">{label}</span>
      <span className="tool-field-value">{children}</span>
    </div>
  );
}

/** Any input as a readable key/value list instead of raw JSON: short strings
 * inline, long or multi-line strings as blocks, nested values as compact JSON. */
export function KeyValueInput({ input }: { input: unknown }) {
  const obj = asInput(input);
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) {
    return Array.isArray(input) ? <pre className="code-block">{JSON.stringify(input, null, 2)}</pre> : null;
  }
  return (
    <div className="tool-fields">
      {entries.map(([key, value]) => {
        if (typeof value === "string") {
          const long = value.length > 140 || value.includes("\n");
          return long ? (
            <div className="tool-field tool-field-block" key={key}>
              <span className="tool-field-label">{key}</span>
              <pre className="code-block">{value}</pre>
            </div>
          ) : (
            <Field label={key} key={key}>
              <code>{value}</code>
            </Field>
          );
        }
        if (typeof value === "number" || typeof value === "boolean") {
          return (
            <Field label={key} key={key}>
              <code>{String(value)}</code>
            </Field>
          );
        }
        return (
          <div className="tool-field tool-field-block" key={key}>
            <span className="tool-field-label">{key}</span>
            <pre className="code-block">{JSON.stringify(value, null, 2)}</pre>
          </div>
        );
      })}
    </div>
  );
}

function BrowserInput({ tool, input }: { tool: string; input: Input }) {
  if (tool === "browser_batch" && Array.isArray(input.actions)) {
    return (
      <ol className="tool-steps">
        {input.actions.map((a: any, i: number) => {
          const inner = splitMcpName(String(a?.name ?? ""))?.tool ?? String(a?.name ?? "");
          return <li key={i}>{describeBrowserAction(inner, asInput(a?.input))}</li>;
        })}
      </ol>
    );
  }
  if (tool === "javascript_tool") {
    return <pre className="code-block">{String(input.text ?? input.code ?? input.script ?? "")}</pre>;
  }
  return <div className="tool-desc">{describeBrowserAction(tool, input)}</div>;
}

function AskUserQuestionInput({ input }: { input: Input }) {
  const questions: any[] = Array.isArray(input.questions) ? input.questions : [];
  return (
    <div className="tool-questions">
      {questions.map((q, i) => (
        <div className="tool-question" key={i}>
          <div>
            {q.header && <span className="turn-pill">{q.header}</span>} <strong>{q.question}</strong>
            {q.multiSelect && <span className="tool-label"> · pick any</span>}
          </div>
          <ul>
            {(Array.isArray(q.options) ? q.options : []).map((o: any, j: number) => (
              <li key={j}>
                <strong>{o.label}</strong>
                {o.description ? ` — ${o.description}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const TODO_ICON: Record<string, string> = { completed: "✅", in_progress: "⏳", pending: "⬜" };

function TodoInput({ input }: { input: Input }) {
  const todos: any[] = Array.isArray(input.todos) ? input.todos : [];
  return (
    <ul className="tool-todos">
      {todos.map((t, i) => (
        <li key={i} className={`todo-${t.status}`}>
          {TODO_ICON[t.status] ?? "•"} {t.content ?? t.activeForm ?? ""}
        </li>
      ))}
    </ul>
  );
}

function AgentInput({ input }: { input: Input }) {
  return (
    <>
      <div className="tool-desc">
        🧩 {input.subagent_type ? <strong>{input.subagent_type}</strong> : "sub-agent"}
        {input.description ? ` — ${input.description}` : ""}
        {input.model ? <span className="tool-label"> · {input.model}</span> : null}
      </div>
      {input.prompt && (
        <details className="tool-result">
          <summary>prompt · {String(input.prompt).split("\n").length} lines</summary>
          <Markdown text={String(input.prompt)} />
        </details>
      )}
    </>
  );
}

/** The most useful view of a tool's input: the command for Bash, the path
 * (+ range) for file tools, the pattern for searches, a step list for browser
 * automation, the questions for AskUserQuestion — and a key/value list
 * (never raw JSON) for anything else. Edit/Write diffs are already shown by
 * the file_edit block that follows, so their bodies are left out here. */
export function ToolInput({ call }: { call: ToolCallEvent }) {
  const input = asInput(call.input);

  switch (call.name) {
    case "Bash":
      return (
        <>
          {input.description && <div className="tool-desc">{input.description}</div>}
          <pre className="code-block code-shell">{String(input.command ?? "")}</pre>
        </>
      );
    case "Read": {
      const range = input.offset || input.limit ? ` (from line ${input.offset ?? 1}${input.limit ? `, ${input.limit} lines` : ""})` : "";
      return (
        <div className="tool-path">
          <code>{input.file_path}</code>
          {range}
        </div>
      );
    }
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return (
        <div className="tool-path">
          <code>{input.file_path ?? input.notebook_path}</code>
          {call.name === "Write" && typeof input.content === "string" && <span className="tool-label"> · {input.content.split("\n").length} lines</span>}
        </div>
      );
    case "Grep":
    case "Glob":
      return (
        <div className="tool-path">
          <code>{input.pattern}</code>
          {input.path ? (
            <>
              {" "}
              in <code>{input.path}</code>
            </>
          ) : null}
          {input.glob ? (
            <>
              {" "}
              · files <code>{input.glob}</code>
            </>
          ) : null}
        </div>
      );
    case "Agent":
    case "Task":
      return <AgentInput input={input} />;
    case "AskUserQuestion":
      return <AskUserQuestionInput input={input} />;
    case "TodoWrite":
      return <TodoInput input={input} />;
    case "WebSearch":
      return <div className="tool-desc">🔎 “{String(input.query ?? "")}”</div>;
    case "WebFetch":
      return (
        <>
          <div className="tool-path">
            <code>{input.url}</code>
          </div>
          {input.prompt && <div className="tool-desc">{input.prompt}</div>}
        </>
      );
    case "Skill":
      return (
        <div className="tool-desc">
          skill <code>{input.skill}</code>
          {input.args ? <> · {String(input.args)}</> : null}
        </div>
      );
    case "ToolSearch":
      return (
        <div className="tool-desc">
          load tools <code>{String(input.query ?? "")}</code>
        </div>
      );
  }

  const mcp = splitMcpName(call.name);
  if (mcp && isBrowserServer(mcp.server)) return <BrowserInput tool={mcp.tool} input={input} />;
  return <KeyValueInput input={call.input} />;
}

/** Text of a result for line counts and plain display. */
export function resultPlainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && typeof b === "object" && (b as any).type === "text")
      .map((b) => String((b as any).text ?? ""))
      .join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content, null, 2);
}

/** Pretty-prints a result that is itself JSON; leaves anything else alone. */
function prettyText(text: string): string {
  const t = text.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    if (t.length < 200_000) {
      try {
        return JSON.stringify(JSON.parse(t), null, 2);
      } catch {
        // not JSON after all
      }
    }
  }
  return text;
}

function ResultImage({ block }: { block: any }) {
  const [big, setBig] = useState(false);
  const src = block?.source;
  if (!src || src.type !== "base64" || !src.data) return <div className="tool-label">[image]</div>;
  return (
    <img
      className={`tool-result-image${big ? " big" : ""}`}
      src={`data:${src.media_type ?? "image/png"};base64,${src.data}`}
      alt="tool result screenshot"
      title={big ? "Click to shrink" : "Click to enlarge"}
      onClick={() => setBig(!big)}
    />
  );
}

/** Summary line for a result: "12 lines · 1 image". */
export function resultSummary(content: unknown): string {
  const blocks = Array.isArray(content) ? content : [];
  const images = blocks.filter((b: any) => b?.type === "image").length;
  const tools = blocks.filter((b: any) => b?.type === "tool_reference").length;
  const text = resultPlainText(content);
  const lines = text ? text.split("\n").length : 0;
  return [
    lines ? `${lines} line${lines === 1 ? "" : "s"}` : "",
    images ? `${images} image${images === 1 ? "" : "s"}` : "",
    tools ? `${tools} tool${tools === 1 ? "" : "s"} loaded` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A tool result rendered by block type: text (JSON pretty-printed),
 * screenshots as images, loaded tools as chips — never base64 dumps. */
export function ToolResultBody({ content }: { content: unknown }) {
  if (!Array.isArray(content)) return <pre className="code-block tool-result-body">{prettyText(resultPlainText(content))}</pre>;
  // Consecutive text blocks (e.g. one per browser_batch step) read better as one block.
  const merged: any[] = [];
  for (const b of content) {
    const last = merged[merged.length - 1];
    if (b?.type === "text" && last?.type === "text") merged[merged.length - 1] = { type: "text", text: `${last.text}\n${b.text ?? ""}` };
    else merged.push(b);
  }
  return (
    <div className="tool-result-blocks">
      {merged.map((b: any, i: number) => {
        if (b?.type === "text") return <pre key={i} className="code-block tool-result-body">{prettyText(String(b.text ?? ""))}</pre>;
        if (b?.type === "image") return <ResultImage key={i} block={b} />;
        if (b?.type === "tool_reference")
          return (
            <span key={i} className="turn-pill">
              🔧 {String(b.tool_name ?? b.name ?? "tool")}
            </span>
          );
        return (
          <pre key={i} className="code-block tool-result-body">
            {JSON.stringify(b, null, 2)}
          </pre>
        );
      })}
    </div>
  );
}

export function hasResultContent(content: unknown): boolean {
  if (Array.isArray(content)) return content.length > 0;
  return resultPlainText(content).length > 0;
}
