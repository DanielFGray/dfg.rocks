import { spawnSync } from "node:child_process";

/**
 * Test suites run against `<db>_test`, which `ops dev db up` provisions on the shared
 * cluster and writes to .env as TEST_DATABASE_URL (the migration login). The API login
 * has the same grants there, so its URL is AUTH_DATABASE_URL pointed at that database.
 */
export function testDatabaseEnv(env: NodeJS.ProcessEnv = process.env) {
  const testUrl = env.TEST_DATABASE_URL;
  const authUrl = env.AUTH_DATABASE_URL;
  if (!testUrl || !authUrl) {
    throw new Error("TEST_DATABASE_URL and AUTH_DATABASE_URL are required; run `bun run db:up`");
  }
  const testAuthUrl = new URL(authUrl);
  testAuthUrl.pathname = new URL(testUrl).pathname;
  return { DATABASE_URL: testUrl, AUTH_DATABASE_URL: testAuthUrl.toString(), NODE_ENV: "test" };
}

/**
 * Installs the graphile-worker schema and applies committed and current migrations to
 * the test database. `ops dev db test` has already reset it and holds its lock, so every
 * test script runs under that wrapper (see package.json).
 */
export function migrateTestDatabase(env: NodeJS.ProcessEnv = process.env) {
  run("bun", ["run", "db:latest"], { ...env, ...testDatabaseEnv(env) });
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}
