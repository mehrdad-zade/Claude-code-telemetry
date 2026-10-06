import type { ToolCallEvent, ToolResultEvent } from "@agent-tel/shared";
import { toolCallLabel } from "../lib/activity.js";

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in (b as any) ? String((b as any).text) : JSON.stringify(b)))
      .join("\n");
  }
  return JSON.stringify(content, null, 2);
}

/** The most useful view of a tool's input: the command for Bash, the path
 * (+ range) for file tools, the pattern for searches — pretty JSON only for
 * tools without a better presentation. Edit/Write diffs are already shown by
 * the file_edit block that follows, so their bodies are left out here. */
function ToolInput({ call }: { call: ToolCallEvent }) {
  const input = (call.input && typeof call.input === "object" ? call.input : {}) as Record<string, any>;

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
      return <div className="tool-path"><code>{input.file_path}</code>{range}</div>;
    }
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return <div className="tool-path"><code>{input.file_path ?? input.notebook_path}</code></div>;
    case "Grep":
    case "Glob":
      return (
        <div className="tool-path">
          <code>{input.pattern}</code>
          {input.path ? <> in <code>{input.path}</code></> : null}
          {input.glob ? <> · files <code>{input.glob}</code></> : null}
        </div>
      );
  }
  return <pre className="code-block">{JSON.stringify(call.input, null, 2) ?? ""}</pre>;
}

export function ToolCallBlock({ call, result, time }: { call: ToolCallEvent; result?: ToolResultEvent; time?: string }) {
  const resultText = result ? stringifyContent(result.content) : null;
  const label = toolCallLabel(call);
  const lineCount = resultText ? resultText.split("\n").length : 0;

  return (
    <div className={`event-block tool-call-block${result?.isError ? " tool-error" : ""}`}>
      <div className="event-label">
        <span>
          🔧 <span className="tool-name">{call.name}</span>
          {label && call.name !== "Bash" && <span className="tool-label"> · {label}</span>}
        </span>
        {result ? (
          result.isError ? (
            <span className="tool-status error">failed</span>
          ) : (
            <span className="tool-status ok">done</span>
          )
        ) : (
          <span className="tool-status pending">running…</span>
        )}
        {time && <span className="event-time">{time}</span>}
      </div>
      <ToolInput call={call} />
      {resultText !== null && resultText.length > 0 && (
        <details className="tool-result" open={result?.isError}>
          <summary>
            {result?.isError ? "error" : "result"} · {lineCount} line{lineCount === 1 ? "" : "s"}
          </summary>
          <pre className="code-block tool-result-body">{resultText}</pre>
        </details>
      )}
    </div>
  );
}
