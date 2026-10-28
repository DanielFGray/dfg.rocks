import { loadEnvFile } from "node:process";
import { spawnSync } from "node:child_process";

loadEnvFile();

function forceIpv4(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.hostname === "localhost" || url.hostname === "::1") url.hostname = "127.0.0.1";
  return url.toString();
}

function withDatabaseSuffix(connectionString: string, suffix: string): string {
  const url = new URL(connectionString);
  const databaseName = url.pathname.replace(/^\/+/, "");
  if (!databaseName) throw new Error("Connection string is missing a database name");
  url.pathname = `/${databaseName}${suffix}`;
  return url.toString();
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}

export default function setup() {
  const databaseUrl = process.env.DATABASE_URL;
  const authDatabaseUrl = process.env.AUTH_DATABASE_URL;
  if (!databaseUrl || !authDatabaseUrl) {
    throw new Error("DATABASE_URL and AUTH_DATABASE_URL are required");
  }

  const testEnv = {
    ...process.env,
    DATABASE_URL: forceIpv4(withDatabaseSuffix(databaseUrl, "_test")),
    AUTH_DATABASE_URL: forceIpv4(withDatabaseSuffix(authDatabaseUrl, "_test")),
    ROOT_DATABASE_URL: forceIpv4(process.env.ROOT_DATABASE_URL ?? ""),
    DATABASE_HOST: "127.0.0.1",
    NODE_ENV: "test",
    NOCONFIRM: "1",
  };

  run("bun", ["run", "db:ensure"], process.env);
  run("bun", ["-b", "graphile-migrate", "reset", "--erase"], testEnv);
  run("bun", ["-b", "--cwd=worker", "graphile-worker", "--schema-only"], testEnv);
  run("bun", ["-b", "graphile-migrate", "watch", "--once"], testEnv);
}
