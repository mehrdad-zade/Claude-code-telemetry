import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStatsCache } from "../src/history/sessionStats.js";

const SESSION = "11111111-2222-3333-4444-555555555555";

function line(obj: unknown) {
  return `${JSON.stringify(obj)}\n`;
}

describe("SessionStatsCache", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tel-stats-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("scores a transcript from disk and totals its tokens", async () => {
    fs.writeFileSync(
      path.join(dir, `${SESSION}.jsonl`),
      line({ type: "user", timestamp: "2026-01-01T00:00:00.000Z", origin: { kind: "human" }, message: { role: "user", content: "Explain how the cache works?" } }) +
        line({
          type: "assistant",
          timestamp: "2026-01-01T00:00:01.000Z",
          message: {
            id: "msg_1",
            model: "claude-opus-5-5",
            usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 999 },
            content: [
              {
                type: "text",
                text: "The cache keeps each session's stats in memory and recomputes them only when a transcript file changes, so the cache works without writing anything to disk.",
              },
            ],
          },
        }),
    );
    const stats = await new SessionStatsCache().get(dir, SESSION);
    expect(stats.totalTokens).toBe(160);
    expect(stats.validation?.turnsScored).toBe(1);
  });

  it("serves the cached result while the files are unchanged", async () => {
    fs.writeFileSync(path.join(dir, `${SESSION}.jsonl`), "");
    const cache = new SessionStatsCache();
    const first = await cache.get(dir, SESSION);
    expect(await cache.get(dir, SESSION)).toBe(first);
  });
});
