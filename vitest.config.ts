import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 300_000,
    include: ["server/test/**/*.test.ts", "app/**/*.test.ts"],
  },
});
