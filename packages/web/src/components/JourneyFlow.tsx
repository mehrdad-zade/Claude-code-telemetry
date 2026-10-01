import { Fragment, useEffect, useRef } from "react";
import dayjs from "dayjs";
import type { TurnRow } from "../lib/turnGroups.js";
import type { JourneyStep } from "../lib/journey.js";
import { STEP_COLOR, STEP_GLYPH } from "../lib/journey.js";

/** The granular, step-by-step journey: one row per instruction/response
 * cycle (same rows as the Visualization section, one level more detailed),
 * each prefixed with the date/time it started, with every individual step
 * (thinking, each tool call, file edit, hand-off, reply) as its own
 * clickable chip in order. A new instruction always starts a new row. */
export function JourneyFlow({
  rows,
  onStepClick,
}: {
  rows: TurnRow[];
  onStepClick: (step: JourneyStep) => void;
}) {
  const lastRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    lastRowRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [rows.length]);

  if (rows.length === 0) {
    return (
      <div className="journey-rows">
        <div className="empty-hint">No activity yet.</div>
      </div>
    );
  }

  return (
    <div className="journey-rows">
      {rows.map((row, i) => (
        <div className="journey-row" key={row.key} ref={i === rows.length - 1 ? lastRowRef : undefined}>
          <div className="journey-row-time" title={row.timestamp}>
            {row.timestamp ? dayjs(row.timestamp).format("MMM D, h:mm:ss A") : ""}
          </div>
          <div className="journey-row-steps">
            {row.steps.length === 0 && <span className="viz-box-empty">—</span>}
            {row.steps.map((step, j) => (
              <Fragment key={step.id}>
                {j > 0 && <span className="journey-arrow">→</span>}
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
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function truncateLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}
