import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
    include: ["server/test/**/*.test.ts", "app/**/*.test.ts"],
    pool: "forks",
    forceExit: true,
  },
});
