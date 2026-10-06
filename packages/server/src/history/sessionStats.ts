import fs from "node:fs";
import path from "node:path";
import { computeSessionStats, type SessionStats } from "@agent-tel/shared";
import { buildSessionReplay } from "./historyReplay.js";
import { discoverSubagentFiles } from "../transcripts/discoverSubagentFiles.js";

/** A live session's transcript changes constantly; rescoring it more often
 * than this buys nothing for a sidebar number. */
const MIN_RECOMPUTE_MS = 10_000;

interface Entry {
  fingerprint: string;
  computedAt: number;
  stats: SessionStats;
}

/** Per-session final validation + total tokens for the sidebar, computed
 * from the full on-disk transcripts (main + sub-agents) with the same shared
 * scorer the browser uses. Cached in memory and recomputed only when a
 * transcript file's size/mtime changes (at most every 10s); concurrent
 * requests for the same session share one computation. Nothing is written
 * to disk. */
export class SessionStatsCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<SessionStats>>();

  async get(projectDir: string, sessionId: string): Promise<SessionStats> {
    const key = path.join(projectDir, sessionId);
    const fingerprint = this.fingerprint(projectDir, sessionId);
    const cached = this.entries.get(key);
    if (cached && (cached.fingerprint === fingerprint || Date.now() - cached.computedAt < MIN_RECOMPUTE_MS)) {
      return cached.stats;
    }

    const running = this.inflight.get(key);
    if (running) return running;

    const job = (async () => {
      const { events } = await buildSessionReplay(projectDir, sessionId);
      const stats = computeSessionStats(events, sessionId);
      this.entries.set(key, { fingerprint, computedAt: Date.now(), stats });
      return stats;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  private fingerprint(projectDir: string, sessionId: string): string {
    const files = [
      path.join(projectDir, `${sessionId}.jsonl`),
      ...discoverSubagentFiles(path.join(projectDir, sessionId)).map((f) => f.filePath),
    ];
    return files
      .map((f) => {
        try {
          const st = fs.statSync(f);
          return `${f}:${st.size}:${st.mtimeMs}`;
        } catch {
          return `${f}:missing`;
        }
      })
      .join("|");
  }
}
