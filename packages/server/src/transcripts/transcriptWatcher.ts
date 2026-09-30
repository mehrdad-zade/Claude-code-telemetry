import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { LiveSession, NormalizedEvent } from "@agent-tel/shared";
import { sessionTranscriptPath, subagentsDirFor } from "../config.js";
import { logger } from "../logger.js";
import type { AgentTree } from "../normalize/agentTree.js";
import { Normalizer } from "../normalize/normalizer.js";
import type { HistoryStore } from "../history/historyStore.js";
import { FileTailer } from "./fileTailer.js";
import { parseLine } from "./jsonlParser.js";

/** Owns everything needed to observe ONE live top-level session: a tailer on
 * its main transcript, and a dynamically-growing set of tailers on whatever
 * sub-agent transcripts appear under it. New sub-agent files are always
 * tailed as soon as they show up on disk — reconciling which parent spawned
 * which child is handled independently by AgentTree once the matching
 * `agent_spawn` event is parsed, so the two concerns never block each other
 * regardless of which arrives first. */
export class TranscriptWatcher {
  private normalizer = new Normalizer();
  private tailers = new Map<string, FileTailer>();
  private seqByAgent = new Map<string, number>();
  private subagentDirWatcher: FSWatcher | null = null;

  constructor(
    private readonly session: LiveSession,
    private readonly agentTree: AgentTree,
    private readonly historyStore: HistoryStore,
    private readonly onEvent: (event: NormalizedEvent) => void
  ) {}

  start(): void {
    this.agentTree.ensureMainAgent(this.session);
    this.watchFile(this.session.sessionId, sessionTranscriptPath(this.session.cwd, this.session.sessionId));
    this.watchSubagentsDir();
  }

  stop(): void {
    for (const tailer of this.tailers.values()) tailer.stop();
    this.tailers.clear();
    this.subagentDirWatcher?.close();
    this.subagentDirWatcher = null;
  }

  private watchFile(agentId: string, filePath: string): void {
    if (this.tailers.has(filePath)) return;

    const tailer = new FileTailer(filePath);
    this.tailers.set(filePath, tailer);

    tailer.on("lines", (lines) => {
      let seq = this.seqByAgent.get(agentId) ?? 0;
      for (const line of lines) {
        const raw = parseLine(line);
        if (raw === null) continue;

        const events = this.normalizer.normalizeLine(raw, {
          sessionId: this.session.sessionId,
          agentId,
          seq,
        });
        seq++;

        for (const event of events) {
          this.agentTree.applyEvent(event);
          this.historyStore.record(event);
          this.onEvent(event);
        }
      }
      this.seqByAgent.set(agentId, seq);
    });

    tailer.on("error", (err) => logger.error("transcript tailer error", filePath, err));
    tailer.start();
  }

  private watchSubagentsDir(): void {
    const dir = subagentsDirFor(this.session.cwd, this.session.sessionId);

    this.subagentDirWatcher = chokidar.watch(dir, {
      ignoreInitial: false,
      depth: 10,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
    });

    this.subagentDirWatcher.on("add", (filePath) => {
      const match = path.basename(filePath).match(/^agent-(.+)\.jsonl$/);
      if (!match) return;
      const agentId = match[1];
      this.agentTree.ensureSubagent(this.session.sessionId, agentId, this.session.cwd);
      this.watchFile(agentId, filePath);
    });

    this.subagentDirWatcher.on("error", (err) => logger.error("subagent dir watch error", dir, err));
  }
}
