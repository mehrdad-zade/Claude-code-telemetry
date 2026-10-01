import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileTailer } from "../src/transcripts/fileTailer.js";

let dir: string;
let filePath: string;
let tailer: FileTailer | null = null;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tel-test-"));
  filePath = path.join(dir, "transcript.jsonl");
});

afterEach(() => {
  tailer?.stop();
  tailer = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

function waitForLines(t: FileTailer, count: number, timeoutMs = 8000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const collected: string[] = [];
    const timer = setTimeout(() => reject(new Error("timed out waiting for lines")), timeoutMs);
    t.on("lines", (lines) => {
      collected.push(...lines);
      if (collected.length >= count) {
        clearTimeout(timer);
        resolve(collected);
      }
    });
  });
}

describe("FileTailer", () => {
  it("picks up a file created after the tailer starts watching it", async () => {
    tailer = new FileTailer(filePath);
    const pending = waitForLines(tailer, 1);
    tailer.start();

    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(filePath, '{"a":1}\n');

    const lines = await pending;
    expect(lines).toEqual(['{"a":1}']);
  });

  it("only reads newly appended lines on subsequent writes", async () => {
    fs.writeFileSync(filePath, '{"a":1}\n');
    tailer = new FileTailer(filePath);
    const first = waitForLines(tailer, 1);
    tailer.start();
    await first;
    // Give the watcher's internal state a beat to settle after the initial
    // "add" before triggering a "change" — avoids a chokidar/fsevents race
    // when the two happen back-to-back within the same tick.
    await new Promise((r) => setTimeout(r, 300));

    const second = waitForLines(tailer, 1);
    fs.appendFileSync(filePath, '{"a":2}\n');
    const lines = await second;

    expect(lines).toEqual(['{"a":2}']);
  });

  it("buffers a partial trailing line until the newline arrives", async () => {
    tailer = new FileTailer(filePath);
    const pending = waitForLines(tailer, 1);
    tailer.start();
    await new Promise((r) => setTimeout(r, 300));

    fs.writeFileSync(filePath, '{"partial":');
    await new Promise((r) => setTimeout(r, 300));
    fs.appendFileSync(filePath, 'true}\n');

    const lines = await pending;
    expect(lines).toEqual(['{"partial":true}']);
  });

  it("resets cleanly when the file is truncated and rewritten", async () => {
    fs.writeFileSync(filePath, '{"a":1}\n{"a":2}\n');
    tailer = new FileTailer(filePath);
    const first = waitForLines(tailer, 2);
    tailer.start();
    await first;
    await new Promise((r) => setTimeout(r, 300));

    const second = waitForLines(tailer, 1);
    fs.writeFileSync(filePath, '{"b":1}\n');
    const lines = await second;

    expect(lines).toEqual(['{"b":1}']);
  });
});
