import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { LiveSession } from "@agent-tel/shared";
import { config } from "../config.js";
import { logger } from "../logger.js";

/** Returns true if a process with this pid exists and is reachable from us.
 * ESRCH = no such process (dead). EPERM = exists but owned by someone else
 * (still "alive" for our purposes, though in practice this is always our
 * own user's Claude Code process). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

interface RawSessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  name?: string;
  status?: string;
  startedAt?: number;
  updatedAt?: number;
}

function readSessionFile(filePath: string): LiveSession | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as RawSessionFile;
    if (!raw.pid || !raw.sessionId || !raw.cwd) return null;
    return {
      pid: raw.pid,
      sessionId: raw.sessionId,
      cwd: raw.cwd,
      name: raw.name ?? path.basename(raw.cwd),
      status: raw.status ?? "unknown",
      startedAt: raw.startedAt ?? Date.now(),
      updatedAt: raw.updatedAt ?? Date.now(),
    };
  } catch {
    // File can be mid-write, deleted between the watcher event and our read,
    // or simply malformed — never let a bad session file take down discovery.
    return null;
  }
}

export interface SessionRegistryEvents {
  sessionAdded: [LiveSession];
  sessionUpdated: [LiveSession];
  sessionRemoved: [LiveSession];
}

/** Watches ~/.claude/sessions/*.json to maintain a live roster of every
 * Claude Code process currently running on this machine, cross-checking
 * process liveness so a stale/leftover file never reports a dead session
 * as live. */
export class SessionRegistry extends EventEmitter {
  private sessions = new Map<number, LiveSession>();
  private watcher: FSWatcher | null = null;
  private livenessTimer: NodeJS.Timeout | null = null;

  start(): void {
    fs.mkdirSync(config.sessionsDir, { recursive: true });

    this.watcher = chokidar.watch(path.join(config.sessionsDir, "*.json"), {
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
    });

    this.watcher.on("add", (filePath) => this.handleUpsert(filePath));
    this.watcher.on("change", (filePath) => this.handleUpsert(filePath));
    this.watcher.on("unlink", (filePath) => this.handleUnlink(filePath));
    this.watcher.on("error", (err) => logger.error("sessionRegistry watch error", err));

    this.livenessTimer = setInterval(() => this.checkLiveness(), config.livenessPollMs);
  }

  stop(): void {
    this.watcher?.close();
    if (this.livenessTimer) clearInterval(this.livenessTimer);
  }

  list(): LiveSession[] {
    return [...this.sessions.values()];
  }

  get(pid: number): LiveSession | undefined {
    return this.sessions.get(pid);
  }

  private handleUpsert(filePath: string): void {
    const pid = pidFromFilename(filePath);
    if (pid === null) return;

    const session = readSessionFile(filePath);
    if (!session) return;

    if (!isProcessAlive(session.pid)) {
      // Stale file left behind by a process that already died.
      this.handleUnlink(filePath);
      return;
    }

    const existed = this.sessions.has(pid);
    this.sessions.set(pid, session);
    this.emit(existed ? "sessionUpdated" : "sessionAdded", session);
  }

  private handleUnlink(filePath: string): void {
    const pid = pidFromFilename(filePath);
    if (pid === null) return;
    const session = this.sessions.get(pid);
    if (!session) return;
    this.sessions.delete(pid);
    this.emit("sessionRemoved", session);
  }

  private checkLiveness(): void {
    for (const session of this.sessions.values()) {
      if (!isProcessAlive(session.pid)) {
        this.sessions.delete(session.pid);
        this.emit("sessionRemoved", session);
      }
    }
  }
}

function pidFromFilename(filePath: string): number | null {
  const base = path.basename(filePath, ".json");
  const pid = Number(base);
  return Number.isInteger(pid) ? pid : null;
}

export declare interface SessionRegistry {
  on<K extends keyof SessionRegistryEvents>(
    event: K,
    listener: (...args: SessionRegistryEvents[K]) => void
  ): this;
  emit<K extends keyof SessionRegistryEvents>(
    event: K,
    ...args: SessionRegistryEvents[K]
  ): boolean;
}
