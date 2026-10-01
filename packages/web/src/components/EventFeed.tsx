import { useEffect, useMemo, useRef, useState } from "react";
import type { NormalizedEvent } from "@agent-tel/shared";
import { splitIntoTurns } from "../lib/turns.js";
import { pairToolResults } from "./eventRendering.js";
import { TurnCard } from "./TurnCard.js";

/** Renders one agent's event history as a list of collapsible "turns" (one
 * human prompt + everything that happened in response) instead of one long
 * unbroken scroll. Only the most recent turn is expanded by default — exactly
 * the part that's "happening now" — while earlier turns compress to a
 * one-line summary you can expand on demand.
 *
 * `focusEventId` lets an external click (from the JourneyFlow timeline)
 * force the turn containing that event open and scroll it into view, with a
 * brief highlight on the specific event — this is what makes a journey step
 * click actually show you more detail instead of just being decorative. */
export function EventFeed({
  events,
  focusEventId,
  focusNonce,
}: {
  events: NormalizedEvent[];
  focusEventId?: string | null;
  focusNonce?: number;
}) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const turns = useMemo(() => splitIntoTurns(events), [events]);
  const results = useMemo(() => pairToolResults(events), [events]);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const turnRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // "Sticky bottom" auto-follow, same pattern as any live chat/log view:
  // only snap to the newest event if the user was already down there. Without
  // this, in a live session (new events keep arriving) clicking a journey
  // step to look at an earlier moment gets immediately yanked back to the
  // bottom by the very next incoming event.
  const isNearBottomRef = useRef(true);

  function handleScroll() {
    const el = feedRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  useEffect(() => {
    if (isNearBottomRef.current) bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [events.length]);

  useEffect(() => {
    if (!focusEventId) return;
    const turn = turns.find((t) => t.prompt?.id === focusEventId || t.events.some((e) => e.id === focusEventId));
    if (!turn) return;

    isNearBottomRef.current = false; // we're about to jump elsewhere on purpose
    setOverrides((prev) => ({ ...prev, [turn.key]: true }));
    setHighlightId(focusEventId);

    // Wait for the expand to actually commit before scrolling to it. A turn
    // can have hundreds of blocks (a long tool-heavy turn), so this scrolls
    // to the specific highlighted event inside it, not just the turn card's
    // top — otherwise you land somewhere arbitrary inside a huge card.
    // Double-RAF: expanding hundreds of blocks can take longer than one
    // frame to paint, so a single RAF can fire before the highlighted
    // element actually exists in the DOM.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const container = turnRefs.current.get(turn.key);
        const target = container?.querySelector<HTMLElement>(".event-highlight") ?? container;
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    const timer = setTimeout(() => setHighlightId(null), 2000);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEventId, focusNonce]);

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
    <div className="event-feed" ref={feedRef} onScroll={handleScroll}>
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
            cardRef={(el) => {
              if (el) turnRefs.current.set(turn.key, el);
              else turnRefs.current.delete(turn.key);
            }}
            highlightEventId={highlightId}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
