#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { resetTestDatabase, testDatabaseEnv } from "./testDatabase.js";

// E2E runs against the production build, so tests see what ships and no file
// write can trigger a dev-server reload mid-test. The server still runs with
// NODE_ENV=test, which mounts the testing API at runtime.
const port = process.env.PLAYWRIGHT_VITE_PORT || process.env.VITE_PORT || "4174";
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  ...testDatabaseEnv(),
  // Vite inlines VITE_* variables at build time, so the build needs the E2E origin.
  VITE_ROOT_URL: `http://127.0.0.1:${port}`,
  // Stripe is faked in NODE_ENV=test (server/services/stripeFake.ts). These values name the fake's
  // prices and only have to be set; no request reaches Stripe.
  STRIPE_SECRET_KEY: "sk_test_e2e_fake",
  STRIPE_PRICE_MONTHLY: "price_e2e_monthly",
  STRIPE_PRICE_ANNUAL: "price_e2e_annual",
  HOST: "127.0.0.1",
  PORT: port,
};

resetTestDatabase();

const build = spawnSync("bun", ["run", "build"], { env: childEnv, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn("bun", ["server/main.ts"], { env: childEnv, stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.kill(signal));
}

server.on("error", (error) => {
  console.error("E2E server failed to start:", error);
  process.exit(1);
});

server.on("exit", (code) => process.exit(code ?? 0));
