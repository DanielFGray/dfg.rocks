#!/usr/bin/env bun
/**
 * dbEnsure — predev hook: start containers, test connection, run init on failure.
 */
import pg from "pg";
// @ts-expect-error no types
import runAll from "npm-run-all";

const run = (scripts: string[]) =>
  runAll(scripts, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    silent: true,
  }) as Promise<void>;

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

async function testConnection(url: string, retries = 7) {
  for (let i = 0; i <= retries; i++) {
    const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
    try {
      await pool.query('SELECT true AS "ok"');
      await pool.end();
      return;
    } catch (error) {
      await pool.end();
      if (getErrorCode(error) === "28P01") throw error; // don't retry auth failures
      if (i === retries) throw error;
      await new Promise((r) => setTimeout(r, 200 * Math.pow(1.8, i)));
    }
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL not set — running full init");
    await run(["init"]);
    return;
  }

  await run(["db:up"]);
  try {
    await testConnection(url);
    console.log("Database is ready");
  } catch (e) {
    console.log(`Connection failed (${e}), running init...`);
    await run(["init"]);
  }
}

main().catch((e) => {
  console.error("dbEnsure failed:", e);
  process.exit(1);
});
