#!/usr/bin/env bun
import { Redacted } from "effect";
import pg from "pg";
import { devEnv } from "./devEnv.js";

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function connectWithRetry(connectionString: string, retries = 10) {
  for (let i = 0; i <= retries; i++) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (getErrorCode(error) === "28P01") throw error;
      if (i === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * Math.pow(1.8, i)));
    }
  }

  throw new Error("Failed to connect to database");
}

async function main() {
  const client = await connectWithRetry(devEnv.ROOT_DATABASE_URL);

  const dbName = devEnv.DATABASE_NAME;
  const owner = devEnv.DATABASE_OWNER;
  const ownerPw = Redacted.value(devEnv.DATABASE_OWNER_PASSWORD);
  const auth = devEnv.DATABASE_AUTHENTICATOR;
  const authPw = Redacted.value(devEnv.DATABASE_AUTHENTICATOR_PASSWORD);
  const visitor = devEnv.DATABASE_VISITOR;
  const shadowPw = Redacted.value(devEnv.SHADOW_DATABASE_PASSWORD);

  const sql = (s: string) =>
    client.query(s).catch((error) => {
      if (!getErrorMessage(error).includes("does not exist")) throw error;
    });

  // Drop existing
  for (const db of [dbName, `${dbName}_shadow`, `${dbName}_test`]) {
    await sql(`DROP DATABASE IF EXISTS "${db}"`);
  }
  for (const role of [owner, auth, visitor, `${dbName}_shadow`]) {
    await sql(`DROP ROLE IF EXISTS "${role}"`);
  }

  // Create roles
  await client.query(`CREATE ROLE "${owner}" LOGIN PASSWORD '${ownerPw}'`);
  await client.query(`CREATE ROLE "${auth}" LOGIN PASSWORD '${authPw}' NOINHERIT`);
  await client.query(`CREATE ROLE "${visitor}"`);
  await client.query(`CREATE ROLE "${dbName}_shadow" LOGIN PASSWORD '${shadowPw}' SUPERUSER`);
  await client.query(`GRANT "${visitor}" TO "${auth}"`);

  // Create databases
  await client.query(`CREATE DATABASE "${dbName}" OWNER "${owner}"`);
  await client.query(`CREATE DATABASE "${dbName}_shadow" OWNER "${dbName}_shadow"`);
  await client.query(`CREATE DATABASE "${dbName}_test" OWNER "${owner}"`);

  console.log(`Created databases and roles for ${dbName}`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
