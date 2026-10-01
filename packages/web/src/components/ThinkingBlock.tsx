import { useState } from "react";

const COLLAPSE_AT = 400;

export function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(text.length <= COLLAPSE_AT);

  if (!text) {
    // Some reasoning-effort/model configurations don't include a readable
    // thinking summary in the transcript, only an empty block (a
    // verification signature). Still worth showing — it marks a real
    // reasoning step in the process — just without content to display.
    return (
      <div className="event-block thinking-block thinking-redacted">
        <div className="event-label">thinking</div>
        <div className="thinking-text thinking-placeholder">(no summary available for this step)</div>
      </div>
    );
  }

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
