#!/usr/bin/env bun
import { execSync, spawn } from "node:child_process";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }

  return value;
}

function withDatabaseSuffix(connectionString: string, suffix: string): string {
  const url = new URL(connectionString);
  const databaseName = url.pathname.replace(/^\/+/, "");

  if (!databaseName) {
    throw new Error(`Connection string is missing a database name: ${connectionString}`);
  }

  url.pathname = `/${databaseName}${suffix}`;
  return url.toString();
}

function withRedisDatabase(connectionString: string, databaseIndex: number): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseIndex}`;
  return url.toString();
}

const childEnv: Record<string, string> = {
  ...process.env,
  DATABASE_URL: withDatabaseSuffix(requiredEnv("DATABASE_URL"), "_test"),
  AUTH_DATABASE_URL: withDatabaseSuffix(requiredEnv("AUTH_DATABASE_URL"), "_test"),
  VALKEY_URL: withRedisDatabase(requiredEnv("VALKEY_URL"), 14),
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
