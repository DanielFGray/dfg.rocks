import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./server/test/globalSetup.ts"],
    setupFiles: ["./server/test/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    include: ["server/test/**/*.test.ts", "app/**/*.test.ts"],
  },
});
