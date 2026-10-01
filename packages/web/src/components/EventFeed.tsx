import { useEffect, useMemo, useRef, useState } from "react";
import type { NormalizedEvent } from "@agent-tel/shared";
import { splitIntoTurns } from "../lib/turns.js";
import { pairToolResults } from "./eventRendering.js";
import { TurnCard } from "./TurnCard.js";

/** Renders one agent's event history as a list of collapsible "turns" (one
 * human prompt + everything that happened in response) instead of one long
 * unbroken scroll. Only the most recent turn is expanded by default — exactly
 * the part that's "happening now" — while earlier turns compress to a
 * one-line summary you can expand on demand. */
export function EventFeed({ events }: { events: NormalizedEvent[] }) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const turns = useMemo(() => splitIntoTurns(events), [events]);
  const results = useMemo(() => pairToolResults(events), [events]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [events.length]);

  function toggle(key: string, defaultExpanded: boolean) {
    setOverrides((prev) => ({ ...prev, [key]: !(prev[key] ?? defaultExpanded) }));
  }

  if (turns.length === 0) {
    return (
      <div className="event-feed">
        <div className="empty-hint">No activity yet.</div>
      </div>
    );
  }

  return (
    <div className="event-feed">
      <div className="turn-feed-controls">
        <button className="link-button" onClick={() => setOverrides(Object.fromEntries(turns.map((t) => [t.key, true])))}>
          expand all
        </button>
        <button
          className="link-button"
          onClick={() => setOverrides(Object.fromEntries(turns.slice(0, -1).map((t) => [t.key, false])))}
        >
          collapse all but latest
        </button>
      </div>
      {turns.map((turn, i) => {
        const isLast = i === turns.length - 1;
        const expanded = overrides[turn.key] ?? isLast;
        return (
          <TurnCard
            key={turn.key}
            turn={turn}
            index={i}
            expanded={expanded}
            onToggle={() => toggle(turn.key, isLast)}
            results={results}
            live={isLast}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
