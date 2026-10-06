import { useState } from "react";
import dayjs from "dayjs";
import type { LiveSession, ProjectHistoryEntry } from "@agent-tel/shared";
import { StatusBadge } from "./StatusBadge.js";
import { SessionStatsLine } from "./SessionStatsLine.js";

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

/** "🧩 3 agents" badge, shown only when sub-agents were involved. */
function AgentCountBadge({ count }: { count?: number }) {
  if (!count || count < 2) return null;
  return (
    <span className="agent-count-badge" title={`Main agent + ${count - 1} sub-agent${count > 2 ? "s" : ""}`}>
      🧩 {count} agents
    </span>
  );
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
  // Live sessions are also in the history scan, which is where agent counts
  // come from (it refreshes every 15s, so a newly spawned sub-agent shows up
  // shortly after).
  const agentCounts = new Map(projects.map((p) => [p.sessionId, p.agentCount]));

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
              title={session.cwd}
            >
              <div className="session-item-title">
                {session.name || basename(session.cwd)}
                <AgentCountBadge count={agentCounts.get(session.sessionId)} />
              </div>
              <SessionStatsLine sessionId={session.sessionId} live />
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
              title={entry.lastPrompt ? `${entry.cwd}\n\nLast prompt: ${entry.lastPrompt}` : entry.cwd}
            >
              <div className="session-item-title">
                {entry.title ?? basename(entry.cwd)}
                {liveIds.has(entry.sessionId) && <span className="live-tag">live</span>}
                <AgentCountBadge count={entry.agentCount} />
              </div>
              <SessionStatsLine
                sessionId={entry.sessionId}
                encodedCwd={entry.encodedCwd}
                live={liveIds.has(entry.sessionId)}
                version={entry.mtimeMs}
              />
              <div className="session-item-meta">
                <span className="timestamp">{dayjs(entry.mtimeMs).fromNow?.() ?? new Date(entry.mtimeMs).toLocaleString()}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
