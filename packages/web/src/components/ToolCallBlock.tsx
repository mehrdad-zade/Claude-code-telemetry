import { useState } from "react";
import type { ToolCallEvent, ToolResultEvent } from "@agent-tel/shared";

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in (b as any) ? String((b as any).text) : JSON.stringify(b)))
      .join("\n");
  }
  return JSON.stringify(content, null, 2);
}

export function ToolCallBlock({ call, result }: { call: ToolCallEvent; result?: ToolResultEvent }) {
  const [expanded, setExpanded] = useState(false);
  const inputText = JSON.stringify(call.input, null, 2) ?? "";
  const resultText = result ? stringifyContent(result.content) : null;
  const big = inputText.length > 300 || (resultText?.length ?? 0) > 300;

  return (
    <div className={`event-block tool-call-block${result?.isError ? " tool-error" : ""}`}>
      <div className="event-label">
        tool · <span className="tool-name">{call.name}</span>
        {result ? (
          result.isError ? (
            <span className="tool-status error"> failed</span>
          ) : (
            <span className="tool-status ok"> done</span>
          )
        ) : (
          <span className="tool-status pending"> running…</span>
        )}
        {big && (
          <button className="link-button" onClick={() => setExpanded((e) => !e)}>
            {expanded ? "collapse" : "expand"}
          </button>
        )}
      </div>
      <pre className="code-block">{big && !expanded ? `${inputText.slice(0, 300)}…` : inputText}</pre>
      {resultText !== null && (
        <>
          <div className="event-sublabel">result</div>
          <pre className="code-block">{big && !expanded ? `${resultText.slice(0, 300)}…` : resultText}</pre>
        </>
      )}
    </div>
  );
}
