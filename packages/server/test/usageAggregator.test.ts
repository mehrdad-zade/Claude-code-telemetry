import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageAggregator, readPlanLimits, windowStarts } from "../src/usage/usageAggregator.js";

function assistantLine(id: string, timestamp: string, input: number, output: number, cacheWrite = 0, cacheRead = 0) {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    message: {
      id,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cacheWrite,
        cache_read_input_tokens: cacheRead,
      },
      content: [{ type: "text", text: "x" }],
    },
  });
}

describe("windowStarts", () => {
  it("uses local midnight, Monday, and the 1st", () => {
    // Sunday Oct 4 2026, mid-afternoon local time.
    const starts = windowStarts(new Date(2026, 9, 4, 15, 30));
    expect(starts.day).toBe(new Date(2026, 9, 4).getTime());
    expect(starts.week).toBe(new Date(2026, 8, 28).getTime());
    expect(starts.month).toBe(new Date(2026, 9, 1).getTime());
  });
});

describe("UsageAggregator", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tel-usage-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("dedupes repeated message lines and buckets by calendar window", async () => {
    const now = new Date(2026, 9, 4, 15, 0); // Sun Oct 4
    const today = new Date(2026, 9, 4, 9, 0).toISOString();
    const earlierThisWeek = new Date(2026, 8, 29, 9, 0).toISOString(); // Tue Sep 29 (prev month)
    const earlierThisMonth = new Date(2026, 9, 2, 9, 0).toISOString(); // Fri Oct 2

    const project = path.join(dir, "-Users-me-proj");
    fs.mkdirSync(path.join(project, "sess-1", "subagents"), { recursive: true });
    fs.writeFileSync(
      path.join(project, "sess-1.jsonl"),
      [
        // Same message split across two lines — must count once.
        assistantLine("m1", today, 10, 20, 100, 5000),
        assistantLine("m1", today, 10, 20, 100, 5000),
        assistantLine("m2", earlierThisWeek, 1, 2, 3),
        assistantLine("m3", earlierThisMonth, 4, 5, 6),
        JSON.stringify({ type: "user", message: { content: "hi" } }),
      ].join("\n")
    );
    fs.writeFileSync(path.join(project, "sess-1", "subagents", "agent-abc.jsonl"), assistantLine("m4", today, 1, 1, 1));

    const summary = await new UsageAggregator(dir, path.join(dir, "missing.json")).summarize(now);

    expect(summary.today).toEqual({ input: 11, output: 21, cacheWrite: 101, cacheRead: 5000 });
    expect(summary.week).toEqual({ input: 16, output: 28, cacheWrite: 110, cacheRead: 5000 });
    expect(summary.month).toEqual({ input: 15, output: 26, cacheWrite: 107, cacheRead: 5000 });
    expect(summary.plan).toBeNull();
  });
});

describe("readPlanLimits", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tel-plan-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads Claude Code's cached /status utilization", async () => {
    const file = path.join(dir, ".claude.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        cachedUsageUtilization: {
          fetchedAtMs: 123,
          utilization: {
            five_hour: { utilization: 1, resets_at: "2026-10-01T03:59:59Z" },
            seven_day: { utilization: 0, resets_at: "2026-10-03T20:59:59Z" },
            extra_usage: { is_enabled: true, monthly_limit: 3000, used_credits: 750, utilization: 25, currency: "USD", decimal_places: 2 },
            limits: [
              { kind: "session", group: "session", percent: 42, resets_at: "2026-10-05T00:00:00Z" },
              { kind: "weekly_all", group: "weekly", percent: 17, resets_at: "2026-10-10T00:00:00Z" },
            ],
          },
        },
      })
    );

    const plan = await readPlanLimits(file);
    expect(plan?.fetchedAtMs).toBe(123);
    expect(plan?.session).toMatchObject({ percent: 42, resetsAt: "2026-10-05T00:00:00Z" });
    expect(plan?.weekly).toMatchObject({ percent: 17 });
    expect(plan?.monthly?.percent).toBe(25);
    expect(plan?.monthly?.detail).toContain("30.00");
  });

  it("falls back to five_hour/seven_day when limits[] is absent", async () => {
    const file = path.join(dir, ".claude.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: 1, utilization: { five_hour: { utilization: 8 }, seven_day: { utilization: 3 } } } })
    );
    const plan = await readPlanLimits(file);
    expect(plan?.session?.percent).toBe(8);
    expect(plan?.weekly?.percent).toBe(3);
    expect(plan?.monthly).toBeUndefined();
  });

  it("returns null for a missing or garbled file", async () => {
    expect(await readPlanLimits(path.join(dir, "nope.json"))).toBeNull();
    const garbled = path.join(dir, "bad.json");
    fs.writeFileSync(garbled, "{not json");
    expect(await readPlanLimits(garbled)).toBeNull();
  });
});
