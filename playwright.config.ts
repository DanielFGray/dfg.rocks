import { defineConfig, devices } from "@playwright/test";

const vitePort = process.env.VITE_PORT || "5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${vitePort}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/chromium",
        },
      },
    },
  ],
  webServer: {
    command: "bun run dev:app",
    url: `http://localhost:${vitePort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
