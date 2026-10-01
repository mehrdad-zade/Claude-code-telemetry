import { Fragment, useEffect, useRef } from "react";
import type { JourneyStep, JourneyTurnMarker } from "../lib/journey.js";
import { STEP_COLOR, STEP_GLYPH } from "../lib/journey.js";

/** The main "what actually happened, in order" visualization: every
 * meaningful step an agent took, rendered as a connected horizontal
 * timeline of clickable chips, grouped into turns by a labeled divider.
 * Replaces the old cramped icon-strip-inside-a-box approach — this is the
 * primary graphical journey view, not a decoration on the agent box. */
export function JourneyFlow({
  steps,
  turnMarkers,
  onStepClick,
}: {
  steps: JourneyStep[];
  turnMarkers: JourneyTurnMarker[];
  onStepClick: (step: JourneyStep) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Default view is "where things are right now" — jump to the latest step
  // whenever new ones arrive, same as the feed's auto-scroll.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
  }, [steps.length]);

  // Let a plain vertical wheel scroll this horizontally too — much more
  // discoverable than requiring shift+scroll for a sideways timeline.
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (e.deltaY === 0) return;
    e.currentTarget.scrollLeft += e.deltaY;
  }

  if (steps.length === 0) {
    return (
      <div className="journey-flow journey-empty">
        <div className="empty-hint">No activity yet.</div>
      </div>
    );
  }

  const markerByTurn = new Map(turnMarkers.map((m) => [m.turnIndex, m]));
  let lastTurn = -1;

  return (
    <div className="journey-flow" ref={scrollRef} onWheel={handleWheel}>
      {steps.map((step, i) => {
        const marker = step.turnIndex !== lastTurn ? markerByTurn.get(step.turnIndex) : undefined;
        const needsArrow = step.turnIndex === lastTurn;
        lastTurn = step.turnIndex;

        return (
          <Fragment key={step.id}>
            {marker && (
              <div className="journey-turn-marker">
                <span className="journey-turn-index">#{marker.turnIndex + 1}</span>
                <span className="journey-turn-label">{marker.label}</span>
              </div>
            )}
            {needsArrow && <span className="journey-arrow">→</span>}
            <button
              className={`journey-step journey-step-${step.kind}${step.isError ? " journey-step-error" : ""}`}
              style={{ ["--step-color" as string]: STEP_COLOR[step.kind] }}
              onClick={() => onStepClick(step)}
              title={step.detail ?? step.label}
            >
              <span className="journey-step-icon">{STEP_GLYPH[step.kind]}</span>
              <span className="journey-step-label">{truncateLabel(step.label)}</span>
            </button>
          </Fragment>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

function truncateLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}
