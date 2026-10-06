import { useState, type ReactNode } from "react";
import dayjs from "dayjs";
import type { LiveSession, ProjectHistoryEntry } from "@agent-tel/shared";
import { StatusBadge } from "./StatusBadge.js";
import { SessionStatsLine, useTokenTotal } from "./SessionStatsLine.js";
import { formatTokens } from "../lib/tokens.js";

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

interface RepoGroup<T> {
  cwd: string;
  name: string;
  items: T[];
}

/** Groups sessions by working directory, keeping the input order (groups by
 *  first appearance). Repos sharing a folder name get their parent added. */
function groupByRepo<T extends { cwd: string }>(items: T[]): RepoGroup<T>[] {
  const groups = new Map<string, RepoGroup<T>>();
  for (const item of items) {
    let group = groups.get(item.cwd);
    if (!group) {
      group = { cwd: item.cwd, name: basename(item.cwd), items: [] };
      groups.set(item.cwd, group);
    }
    group.items.push(item);
  }
  const result = [...groups.values()];
  const nameCounts = new Map<string, number>();
  for (const g of result) nameCounts.set(g.name, (nameCounts.get(g.name) ?? 0) + 1);
  for (const g of result) {
    if (nameCounts.get(g.name)! > 1) g.name = g.cwd.split("/").filter(Boolean).slice(-2).join("/");
  }
  return result;
}

/** Total tokens across every session of a repo, shown in its group header. */
function RepoTokenTotal({ sessionIds }: { sessionIds: string[] }) {
  const { total, counted } = useTokenTotal(sessionIds);
  if (counted === 0) return null;
  const partial = counted < sessionIds.length;
  return (
    <span
      className="repo-group-tokens"
      title={`${total.toLocaleString()} tokens across ${counted} of ${sessionIds.length} session${
        sessionIds.length > 1 ? "s" : ""
      }${partial ? " (rest still loading)" : ""}`}
    >
      {partial ? "≥" : ""}
      {formatTokens(total)} tok
    </span>
  );
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
  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(() => new Set());
  const liveIds = new Set(roster.map((s) => s.sessionId));
  // Live sessions are also in the history scan, which is where agent counts
  // come from (it refreshes every 15s, so a newly spawned sub-agent shows up
  // shortly after).
  const agentCounts = new Map(projects.map((p) => [p.sessionId, p.agentCount]));

  const toggleRepo = (cwd: string) =>
    setCollapsedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });

  const renderGroups = <T extends { cwd: string; sessionId: string }>(items: T[], renderItem: (item: T) => ReactNode) =>
    groupByRepo(items).map((group) => {
      const isCollapsed = collapsedRepos.has(group.cwd);
      return (
        <div key={group.cwd} className="repo-group">
          <button className="repo-group-header" onClick={() => toggleRepo(group.cwd)} title={group.cwd}>
            <span className="repo-group-caret">{isCollapsed ? "▸" : "▾"}</span>
            <span className="repo-group-name">{group.name}</span>
            <RepoTokenTotal sessionIds={group.items.map((i) => i.sessionId)} />
            <span className="repo-group-count">{group.items.length}</span>
          </button>
          {!isCollapsed && group.items.map(renderItem)}
        </div>
      );
    });

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
          {renderGroups(roster, (session) => (
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
          {renderGroups(projects, (entry) => (
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
