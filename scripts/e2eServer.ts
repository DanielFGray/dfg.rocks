#!/usr/bin/env bun
import { execSync, spawn } from "node:child_process";
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

const vitePort = process.env.VITE_PORT || process.env.PLAYWRIGHT_VITE_PORT || "4174";

const childEnv: Record<string, string> = {
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

for (const command of [
  "bun run db:ensure",
  "bun -b graphile-migrate reset --erase",
  "cd worker && bun -b graphile-worker --schema-only",
  "bun -b graphile-migrate watch --once",
]) {
  execSync(command, {
    cwd: process.cwd(),
    env: childEnv,
    stdio: "inherit",
  });
}

const server = spawn("bun", ["run", "dev:app"], {
  cwd: process.cwd(),
  env: childEnv,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.kill(signal);
  });
}

server.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
