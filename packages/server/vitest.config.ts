import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // chokidar's native fsevents backend on macOS is unreliable inside
    // vitest's default worker_threads pool (watchers silently miss
    // subsequent change events). Running each test file in a real child
    // process avoids that entirely.
    pool: "forks",
  },
});
