import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { AgentNode, NormalizedEvent } from "@agent-tel/shared";
import { AgentTree } from "../normalize/agentTree.js";
import { Normalizer } from "../normalize/normalizer.js";
import { discoverSubagentFiles } from "../transcripts/discoverSubagentFiles.js";

export interface SessionReplay {
  agents: AgentNode[];
  events: NormalizedEvent[];
}

/** Streams a (possibly large, possibly no-longer-live) session's main
 * transcript plus every sub-agent transcript found under it, line-by-line
 * (never loading raw file text fully into memory at once), and replays them
 * through the same Normalizer/AgentTree used for live sessions so scrollback
 * renders identically to what would have been seen live. The resulting
 * event list IS held in memory for the response — reasonable for a single
 * session's history in a personal local tool, unlike the live path which
 * never accumulates more than a bounded ring buffer.
 *
 * `projectDir` is the already-encoded `~/.claude/projects/<encodedCwd>`
 * directory (the caller resolves encoding, since a historical/no-longer-live
 * session may only be known by its encoded directory name, not a real cwd). */
export async function buildSessionReplay(projectDir: string, sessionId: string): Promise<SessionReplay> {
  const normalizer = new Normalizer();
  const agentTree = new AgentTree();
  const events: NormalizedEvent[] = [];

  // cwd isn't known until the first line of the main transcript is parsed
  // (every line carries it) — seed with a placeholder and let the real cwd
  // fill in via agent_upsert-style updates as normal lines arrive. Since
  // AgentNode.cwd isn't otherwise surfaced prominently in the UI, an empty
  // placeholder that never gets backfilled is harmless; ensuring the node
  // exists at all (so it shows up in the graph) is what matters here.
  agentTree.ensureMainAgent({ sessionId, cwd: "" });

  const mainPath = path.join(projectDir, `${sessionId}.jsonl`);
  await replayFile(mainPath, { sessionId, agentId: sessionId }, normalizer, agentTree, events);

  const sessionDir = path.join(projectDir, sessionId);
  for (const { agentId, filePath } of discoverSubagentFiles(sessionDir)) {
    await replayFile(filePath, { sessionId, agentId }, normalizer, agentTree, events);
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { agents: agentTree.getTree(sessionId), events };
}

async function replayFile(
  filePath: string,
  ids: { sessionId: string; agentId: string },
  normalizer: Normalizer,
  agentTree: AgentTree,
  out: NormalizedEvent[]
): Promise<void> {
  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(filePath, { encoding: "utf8" });
  } catch {
    return;
  }

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let seq = 0;
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      const newEvents = normalizer.normalizeLine(raw, { sessionId: ids.sessionId, agentId: ids.agentId, seq });
      seq++;
      for (const event of newEvents) {
        agentTree.applyEvent(event);
        out.push(event);
      }
    }
  } catch {
    // Stream error mid-file (e.g. transcript deleted underneath us) — return
    // whatever was successfully read rather than failing the whole replay.
  } finally {
    rl.close();
  }
}
