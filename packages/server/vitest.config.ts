import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // chokidar's native fsevents backend on macOS is unreliable inside
    // vitest's default worker_threads pool (watchers silently miss
    // subsequent change events). Running each test file in a real child
    // process avoids that entirely.
    pool: "forks",
    // Real filesystem-watcher tests (fileTailer) can legitimately take a
    // few seconds under system load (e.g. other chokidar/esbuild watchers
    // already running on the same machine) — the default 5s per-test
    // timeout is too tight for those.
    testTimeout: 15000,
  },
});
