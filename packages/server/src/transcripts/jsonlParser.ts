import { logger } from "../logger.js";

/** Parses one JSONL line. Never throws — a malformed line (partial write,
 * future format change, hand-edited scratch file) is logged and skipped
 * rather than taking down the whole tailer. */
export function parseLine(line: string): unknown | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    logger.warn("skipping malformed JSONL line", (err as Error).message);
    return null;
  }
}
