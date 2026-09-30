import { useEffect, useRef, useState } from "react";

const SPEEDS = [
  { label: "1x", ms: 250 },
  { label: "4x", ms: 60 },
  { label: "16x", ms: 15 },
];

export function ReplayControls({
  total,
  cursor,
  playing,
  onCursorChange,
  onPlayingChange,
}: {
  total: number;
  cursor: number;
  playing: boolean;
  onCursorChange: (cursor: number) => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const [speedIdx, setSpeedIdx] = useState(0);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  useEffect(() => {
    if (!playing) return;
    if (cursorRef.current >= total) {
      onPlayingChange(false);
      return;
    }
    const timer = setInterval(() => {
      const next = cursorRef.current + 1;
      onCursorChange(next);
      if (next >= total) onPlayingChange(false);
    }, SPEEDS[speedIdx].ms);
    return () => clearInterval(timer);
  }, [playing, speedIdx, total, onCursorChange, onPlayingChange]);

  return (
    <div className="replay-controls">
      <button onClick={() => onPlayingChange(!playing)} disabled={total === 0}>
        {playing ? "Pause" : "Play"}
      </button>
      <input
        type="range"
        min={0}
        max={total}
        value={cursor}
        onChange={(e) => onCursorChange(Number(e.target.value))}
      />
      <span className="replay-position">
        {cursor} / {total}
      </span>
      <div className="speed-picker">
        {SPEEDS.map((s, i) => (
          <button
            key={s.label}
            className={i === speedIdx ? "active" : ""}
            onClick={() => setSpeedIdx(i)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <button onClick={() => onCursorChange(total)}>Jump to end</button>
    </div>
  );
}
