#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { resetTestDatabase, testDatabaseEnv } from "./testDatabase.js";

const vitePort = process.env.PLAYWRIGHT_VITE_PORT || process.env.VITE_PORT || "4174";
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  ...testDatabaseEnv(),
  VITE_ROOT_URL: `http://127.0.0.1:${vitePort}`,
  HOST: "127.0.0.1",
  VITE_PORT: vitePort,
};

resetTestDatabase();

const server = spawn("bun", ["-b", "vite", "dev"], {
  cwd: process.cwd(),
  env: childEnv,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.kill(signal));
}

server.on("error", (error) => {
  console.error("E2E server failed to start:", error);
  process.exit(1);
});

server.on("exit", (code) => process.exit(code ?? 0));
