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
 * Drops and re-provisions the test database through `ops`, then installs the
 * graphile-worker schema and applies committed and current migrations.
 */
export function resetTestDatabase(env: NodeJS.ProcessEnv = process.env) {
  const testEnv = { ...env, ...testDatabaseEnv(env) };
  const name = new URL(testEnv.DATABASE_URL).pathname.slice(1);
  run("ops", ["dev", "db", "reset", name], env);
  run("bun", ["run", "db:latest"], testEnv);
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}
