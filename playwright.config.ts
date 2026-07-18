import { defineConfig, devices } from "@playwright/test";

const vitePort = process.env.PLAYWRIGHT_VITE_PORT || process.env.VITE_PORT || "4174";
const baseURL = `http://127.0.0.1:${vitePort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
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
    command: "bun run e2e:server",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
