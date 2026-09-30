import os from "node:os";
import path from "node:path";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");

export const config = {
  claudeDir: CLAUDE_DIR,
  sessionsDir: path.join(CLAUDE_DIR, "sessions"),
  projectsDir: path.join(CLAUDE_DIR, "projects"),

  /** Bind to loopback ONLY — transcripts can contain file contents/secrets
   * from any of the user's projects. This must never be reachable off-box. */
  host: "127.0.0.1",
  port: Number(process.env.AGENT_TEL_PORT ?? 4317),

  /** How often to re-check that a registered pid is still alive. */
  livenessPollMs: 3000,

  /** How many recent events per agent to keep in memory for instant
   * subscribe snapshots (bounded regardless of total transcript size). */
  ringBufferSize: 500,

  /** How long to keep an ended session's in-memory buffers around for a
   * late-joining client before relying purely on disk for history. */
  endedSessionGraceMs: 5 * 60 * 1000,
} as const;

/** Mirrors Claude Code's own directory-name encoding for a project path:
 * every "/" and "." becomes "-". Verified against real ~/.claude/projects
 * entries on this machine (e.g. "/Users/zade/x.io" -> "-Users-zade-x-io"). */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

export function projectDirFor(cwd: string): string {
  return path.join(config.projectsDir, encodeProjectDir(cwd));
}

export function sessionTranscriptPath(cwd: string, sessionId: string): string {
  return path.join(projectDirFor(cwd), `${sessionId}.jsonl`);
}

export function subagentsDirFor(cwd: string, sessionId: string): string {
  return path.join(projectDirFor(cwd), sessionId, "subagents");
}
