#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { env } from "../server/assertEnv.js";

function withDatabaseSuffix(connectionString: string, suffix: string): string {
  const url = new URL(connectionString);
  const databaseName = url.pathname.replace(/^\/+/, "");

  if (!databaseName) {
    throw new Error(`Connection string is missing a database name: ${connectionString}`);
  }

  url.pathname = `/${databaseName}${suffix}`;
  return url.toString();
}

function forceIpv4(urlString: string): string {
  const url = new URL(urlString);
  if (url.hostname === "localhost" || url.hostname === "::1") {
    url.hostname = "127.0.0.1";
  }
  return url.toString();
}

const vitePort = process.env.PLAYWRIGHT_VITE_PORT || process.env.VITE_PORT || "4174";
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: forceIpv4(withDatabaseSuffix(env.DATABASE_URL, "_test")),
  AUTH_DATABASE_URL: forceIpv4(withDatabaseSuffix(env.AUTH_DATABASE_URL, "_test")),
  ROOT_DATABASE_URL: forceIpv4(env.ROOT_DATABASE_URL),
  DATABASE_HOST: "127.0.0.1",
  VITE_ROOT_URL: `http://127.0.0.1:${vitePort}`,
  HOST: "127.0.0.1",
  VITE_PORT: vitePort,
  NODE_ENV: "test",
};

function run(command: string, args: string[], cwd = process.cwd()): void {
  const result = spawnSync(command, args, {
    cwd,
    env: childEnv,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}

run("bun", ["run", "db:ensure"]);
run("bun", ["-b", "graphile-migrate", "reset", "--erase"]);
run("bun", ["-b", "graphile-worker", "--schema-only"], `${process.cwd()}/worker`);
run("bun", ["-b", "graphile-migrate", "watch", "--once"]);

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
