import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { ProjectHistoryEntry } from "@agent-tel/shared";
import { config } from "../config.js";
import { discoverSubagentFiles } from "../transcripts/discoverSubagentFiles.js";

interface SessionFileMeta {
  cwd: string | null;
  title: string | null;
  lastPrompt: string | null;
}

/** Streams a transcript file line-by-line (never loads it whole into memory)
 * to pull out its cwd and most recent ai-title/last-prompt, for labeling it
 * in the scrollback picker. */
async function readSessionMeta(filePath: string): Promise<SessionFileMeta> {
  const meta: SessionFileMeta = { cwd: null, title: null, lastPrompt: null };
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (!meta.cwd && typeof obj.cwd === "string") meta.cwd = obj.cwd;
      if (obj.type === "ai-title" && typeof obj.aiTitle === "string") meta.title = obj.aiTitle;
      if (obj.type === "last-prompt" && typeof obj.lastPrompt === "string") meta.lastPrompt = obj.lastPrompt;
    }
  } finally {
    rl.close();
  }
  return meta;
}

/** Enumerates every session transcript under ~/.claude/projects, across all
 * of the user's projects, for the scrollback/history picker. `liveSessionIds`
 * lets the caller flag which of these are also currently live. */
export async function listProjectHistory(liveSessionIds: Set<string>): Promise<ProjectHistoryEntry[]> {
  const entries: ProjectHistoryEntry[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await fs.promises.readdir(config.projectsDir);
  } catch {
    return entries;
  }

  for (const encodedCwd of projectDirs) {
    const dirPath = path.join(config.projectsDir, encodedCwd);
    let dirStat;
    try {
      dirStat = await fs.promises.stat(dirPath);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;

    let files: string[];
    try {
      files = await fs.promises.readdir(dirPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const sessionId = file.slice(0, -".jsonl".length);
      const filePath = path.join(dirPath, file);

      let fileStat;
      try {
        fileStat = await fs.promises.stat(filePath);
      } catch {
        continue;
      }

      const meta = await readSessionMeta(filePath);
      entries.push({
        encodedCwd,
        cwd: meta.cwd ?? encodedCwd,
        sessionId,
        title: meta.title ?? undefined,
        lastPrompt: meta.lastPrompt ?? undefined,
        mtimeMs: fileStat.mtimeMs,
        isLive: liveSessionIds.has(sessionId),
        // Each sub-agent gets its own subagents/agent-<id>.jsonl under
        // <sessionId>/, so the file count is the sub-agent count.
        agentCount: 1 + discoverSubagentFiles(path.join(dirPath, sessionId)).length,
      });
    }
  }

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries;
}
