import fs from "node:fs";
import path from "node:path";

export interface SubagentFile {
  agentId: string;
  filePath: string;
}

/** Recursively finds every agent-<id>.jsonl file under a session's own
 * directory. Claude Code has only ever been observed to nest one level
 * (`<sessionId>/subagents/agent-<id>.jsonl`) on this machine, but this walks
 * arbitrarily-nested `subagents/` directories defensively so a deeper
 * nesting layout (sub-agent spawning its own sub-agent) is picked up without
 * a code change, capped at a sane depth to avoid runaway recursion. */
export function discoverSubagentFiles(sessionDir: string, maxDepth = 6): SubagentFile[] {
  const results: SubagentFile[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && /^agent-.+\.jsonl$/.test(entry.name)) {
        const agentId = entry.name.slice("agent-".length, -".jsonl".length);
        results.push({ agentId, filePath: full });
      }
    }
  }

  walk(sessionDir, 0);
  return results;
}
