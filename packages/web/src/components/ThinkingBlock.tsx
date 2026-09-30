import { useState } from "react";

const COLLAPSE_AT = 400;

export function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(text.length <= COLLAPSE_AT);
  const shown = expanded ? text : `${text.slice(0, COLLAPSE_AT)}…`;

  return (
    <div className="event-block thinking-block">
      <div className="event-label">thinking</div>
      <div className="thinking-text">{shown}</div>
      {text.length > COLLAPSE_AT && (
        <button className="link-button" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
