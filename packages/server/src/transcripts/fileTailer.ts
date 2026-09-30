import { EventEmitter } from "node:events";
import fs from "node:fs";
import chokidar, { type FSWatcher } from "chokidar";
import { logger } from "../logger.js";

/** Generic incremental line-tailer for an append-only file (a Claude Code
 * transcript). Reads only the bytes appended since the last read, handles a
 * file that doesn't exist yet (starts tailing the moment it appears),
 * truncation/replacement (offset resets), and a partial trailing line
 * spanning two reads (buffered until the newline arrives). */
export class FileTailer extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private offset = 0;
  private pending = "";
  private reading = false;
  private rereadQueued = false;

  constructor(private readonly filePath: string) {
    super();
  }

  start(): void {
    this.watcher = chokidar.watch(this.filePath, {
      // The file usually doesn't exist yet when we start watching a
      // sub-agent that hasn't been created on disk yet.
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
      usePolling: false,
    });

    this.watcher.on("add", () => this.readNewData());
    this.watcher.on("change", () => this.readNewData());
    this.watcher.on("error", (err) => this.emit("error", err));
  }

  stop(): void {
    this.watcher?.close();
  }

  /** Re-reads from the current offset, tolerating truncation/rotation. */
  private readNewData(): void {
    if (this.reading) {
      this.rereadQueued = true;
      return;
    }
    this.reading = true;
    try {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(this.filePath);
      } catch {
        // Disappeared between the watch event and our stat; nothing to read.
        return;
      }

      if (stat.size < this.offset) {
        // File was truncated or replaced (rotation) — start over.
        this.offset = 0;
        this.pending = "";
      }

      if (stat.size === this.offset) return;

      const fd = fs.openSync(this.filePath, "r");
      try {
        const length = stat.size - this.offset;
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, this.offset);
        this.offset = stat.size;

        const text = this.pending + buffer.toString("utf8");
        const lines = text.split("\n");
        // The last element is either "" (text ended in a newline) or a
        // partial line to carry over to the next read.
        this.pending = lines.pop() ?? "";

        const complete = lines.filter((l) => l.length > 0);
        if (complete.length > 0) this.emit("lines", complete);
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      logger.error("fileTailer read error", this.filePath, err);
      this.emit("error", err);
    } finally {
      this.reading = false;
      if (this.rereadQueued) {
        this.rereadQueued = false;
        this.readNewData();
      }
    }
  }
}

export interface FileTailerEvents {
  lines: [string[]];
  error: [unknown];
}

export declare interface FileTailer {
  on<K extends keyof FileTailerEvents>(
    event: K,
    listener: (...args: FileTailerEvents[K]) => void
  ): this;
  emit<K extends keyof FileTailerEvents>(event: K, ...args: FileTailerEvents[K]): boolean;
}
