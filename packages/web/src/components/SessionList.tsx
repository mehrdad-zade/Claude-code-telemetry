import { useState } from "react";
import dayjs from "dayjs";
import type { LiveSession, ProjectHistoryEntry } from "@agent-tel/shared";
import { StatusBadge } from "./StatusBadge.js";

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

export function SessionList({
  roster,
  projects,
  selectedSessionId,
  onSelectLive,
  onSelectReplay,
}: {
  roster: LiveSession[];
  projects: ProjectHistoryEntry[];
  selectedSessionId: string | null;
  onSelectLive: (session: LiveSession) => void;
  onSelectReplay: (entry: ProjectHistoryEntry) => void;
}) {
  const [tab, setTab] = useState<"live" | "history">("live");
  const [collapsed, setCollapsed] = useState(false);
  const liveIds = new Set(roster.map((s) => s.sessionId));

  if (collapsed) {
    return (
      <div className="session-list session-list-collapsed">
        <button className="sidebar-toggle" onClick={() => setCollapsed(false)} title="Expand">
          »
        </button>
      </div>
    );
  }

  return (
    <div className="session-list">
      <div className="session-list-tabs">
        <button className={tab === "live" ? "active" : ""} onClick={() => setTab("live")}>
          Live Trace ({roster.length})
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          History Trace
        </button>
        <button className="sidebar-toggle" onClick={() => setCollapsed(true)} title="Collapse">
          «
        </button>
      </div>

      {tab === "live" && (
        <div className="session-list-items">
          {roster.length === 0 && <div className="empty-hint">No Claude Code sessions running.</div>}
          {roster.map((session) => (
            <button
              key={session.sessionId}
              className={`session-item${session.sessionId === selectedSessionId ? " selected" : ""}`}
              onClick={() => onSelectLive(session)}
            >
              <div className="session-item-title">{session.name || basename(session.cwd)}</div>
              <div className="session-item-cwd">{session.cwd}</div>
              <StatusBadge status={session.status === "busy" ? "thinking" : "idle"} />
            </button>
          ))}
        </div>
      )}

      {tab === "history" && (
        <div className="session-list-items">
          {projects.length === 0 && <div className="empty-hint">No recorded sessions found yet.</div>}
          {projects.map((entry) => (
            <button
              key={entry.sessionId}
              className={`session-item${entry.sessionId === selectedSessionId ? " selected" : ""}`}
              onClick={() => onSelectReplay(entry)}
            >
              <div className="session-item-title">
                {entry.title ?? basename(entry.cwd)}
                {liveIds.has(entry.sessionId) && <span className="live-tag">live</span>}
              </div>
              <div className="session-item-cwd">{entry.cwd}</div>
              <div className="session-item-meta">
                {entry.lastPrompt && <span className="last-prompt">{entry.lastPrompt.slice(0, 60)}</span>}
                <span className="timestamp">{dayjs(entry.mtimeMs).fromNow?.() ?? new Date(entry.mtimeMs).toLocaleString()}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
