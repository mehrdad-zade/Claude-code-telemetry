import { useEffect, useState, useSyncExternalStore } from "react";
import type { SessionStats } from "@agent-tel/shared";
import { api } from "../api/client.js";
import { formatTokens } from "../lib/tokens.js";

const LIVE_REFRESH_MS = 15_000;

// Last stats per session, so switching tabs or re-rendering the list doesn't
// flash a placeholder.
const cache = new Map<string, SessionStats>();
// Bumped on every cache write so aggregate views (repo totals) re-render.
let cacheVersion = 0;
const listeners = new Set<() => void>();

function setCached(sessionId: string, stats: SessionStats) {
  cache.set(sessionId, stats);
  cacheVersion++;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sum of total tokens over the given sessions, from whatever stats have
 * loaded so far; `counted` says how many of them contributed. */
export function useTokenTotal(sessionIds: string[]): { total: number; counted: number } {
  useSyncExternalStore(subscribe, () => cacheVersion);
  let total = 0;
  let counted = 0;
  for (const id of sessionIds) {
    const s = cache.get(id);
    if (s) {
      total += s.totalTokens;
      counted++;
    }
  }
  return { total, counted };
}

function useSessionStats(sessionId: string, encodedCwd: string | undefined, live: boolean, version: number): SessionStats | undefined {
  const [stats, setStats] = useState(() => cache.get(sessionId));

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .stats(sessionId, encodedCwd)
        .then((s) => {
          setCached(sessionId, s);
          if (!cancelled) setStats(s);
        })
        .catch(() => {
          // leave the last known value; the next refresh will retry
        });
    load();
    const timer = live ? window.setInterval(load, LIVE_REFRESH_MS) : undefined;
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId, encodedCwd, live, version]);

  return stats;
}

function verdict(accuracy: number): string {
  return accuracy >= 70 ? "met" : accuracy >= 40 ? "partial" : "unmet";
}

function verdictIcon(accuracy: number): string {
  return accuracy >= 70 ? "✅" : accuracy >= 40 ? "🟡" : "❌";
}

/** The sidebar's per-session summary: final validation over the entire
 * session and its total token count, both from the full transcripts on disk
 * (refreshed every 15s while live, or whenever a history entry changes). */
export function SessionStatsLine({
  sessionId,
  encodedCwd,
  live,
  version = 0,
}: {
  sessionId: string;
  encodedCwd?: string;
  live: boolean;
  /** Bump to refetch (e.g. the history entry's mtime). */
  version?: number;
}) {
  const stats = useSessionStats(sessionId, encodedCwd, live, version);
  if (!stats) return <div className="session-item-stats session-stats-loading">scoring…</div>;

  const v = stats.validation;
  const title = [
    v
      ? `Final validation ${v.accuracy}% (90% CI ${v.interval[0]}–${v.interval[1]})\n${v.met} met · ${v.partial} partial · ${v.unmet} unmet${
          v.superseded ? ` · ${v.superseded} redone` : ""
        } · confidence ${v.confidenceLevel}`
      : "No completed turns to validate yet",
    `Total tokens: ${stats.totalTokens.toLocaleString()} (input + output + cache writes, all agents)`,
  ].join("\n");

  return (
    <div className="session-item-stats" title={title}>
      {v ? (
        <span className={`viz-verdict-${verdict(v.accuracy)} session-stats-validation`}>
          {verdictIcon(v.accuracy)} {v.accuracy}% final
        </span>
      ) : (
        <span className="session-stats-muted">validation —</span>
      )}
      <span className="session-stats-sep">·</span>
      <span className="session-stats-tokens">{formatTokens(stats.totalTokens)} tok</span>
    </div>
  );
}
