import type { NormalizedEvent } from "@agent-tel/shared";
import { config } from "../config.js";

/** Fixed-capacity FIFO buffer — bounds memory regardless of how large a
 * session's on-disk transcript grows. */
class RingBuffer<T> {
  private items: T[] = [];
  constructor(private readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.shift();
  }

  toArray(): T[] {
    return [...this.items];
  }
}

/** Keeps the last N normalized events per agent in memory so a client that
 * subscribes (or reconnects) gets an instant, non-empty snapshot instead of
 * waiting for new live events. Full historical replay for scrollback reads
 * straight off disk instead (see transcripts/transcriptWatcher.ts's replay
 * path in http/routes/transcript.ts) — this store is only ever a recent-tail
 * cache, never the source of truth. */
export class HistoryStore {
  private buffers = new Map<string, RingBuffer<NormalizedEvent>>();
  /** sessionId -> agentIds, so a whole-session snapshot can be assembled. */
  private sessionAgents = new Map<string, Set<string>>();

  record(event: NormalizedEvent): void {
    let buf = this.buffers.get(event.agentId);
    if (!buf) {
      buf = new RingBuffer(config.ringBufferSize);
      this.buffers.set(event.agentId, buf);
    }
    buf.push(event);

    let agents = this.sessionAgents.get(event.sessionId);
    if (!agents) {
      agents = new Set();
      this.sessionAgents.set(event.sessionId, agents);
    }
    agents.add(event.agentId);
  }

  recentForAgent(agentId: string): NormalizedEvent[] {
    return this.buffers.get(agentId)?.toArray() ?? [];
  }

  recentForSession(sessionId: string): NormalizedEvent[] {
    const agents = this.sessionAgents.get(sessionId);
    if (!agents) return [];
    const all: NormalizedEvent[] = [];
    for (const agentId of agents) all.push(...this.recentForAgent(agentId));
    all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return all;
  }

  /** Drops in-memory buffers for a session some time after it ends — called
   * from a timer set up wherever `sessionRemoved` is handled. */
  evictSession(sessionId: string): void {
    const agents = this.sessionAgents.get(sessionId);
    if (agents) for (const agentId of agents) this.buffers.delete(agentId);
    this.sessionAgents.delete(sessionId);
  }
}
