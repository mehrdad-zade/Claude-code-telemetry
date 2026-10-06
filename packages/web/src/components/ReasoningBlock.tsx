import dayjs from "dayjs";
import type { ReasoningStep } from "../lib/reasoning.js";
import { Markdown } from "./Markdown.js";

/** One reasoning step in the log: every recorded piece of thinking and the
 * agent's narration in that step, in full, plus what it did next. Thinking
 * blocks Claude Code didn't save text for are only counted, not shown as
 * empty boxes. */
export function ReasoningBlock({ step }: { step: ReasoningStep }) {
  const time = step.events[0]?.timestamp ? dayjs(step.events[0].timestamp).format("h:mm:ss A") : "";
  const onlyUnrecorded = step.texts.length === 0;

  return (
    <div className={`event-block reasoning-block${onlyUnrecorded ? " reasoning-empty" : ""}`}>
      <div className="event-label">
        <span>💭 reasoning</span>
        {onlyUnrecorded && <span className="reasoning-note">thinking text not recorded by Claude Code</span>}
        <span className="event-time">{time}</span>
      </div>
      {step.texts.map((t, i) => (
        <div key={i} className={`reasoning-part reasoning-${t.source}`}>
          {t.source === "thinking" && <span className="reasoning-tag">thinking</span>}
          <Markdown text={t.text} />
        </div>
      ))}
      {(step.next || (!onlyUnrecorded && step.unrecordedThinking > 0)) && (
        <div className="reasoning-footer">
          {step.next && (
            <span>
              <span className="reasoning-next-label">Next</span> {step.next}
            </span>
          )}
          {!onlyUnrecorded && step.unrecordedThinking > 0 && (
            <span className="reasoning-note">
              + {step.unrecordedThinking} thinking block{step.unrecordedThinking > 1 ? "s" : ""} not recorded
            </span>
          )}
        </div>
      )}
    </div>
  );
}
