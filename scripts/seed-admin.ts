#!/usr/bin/env bun
/**
 * Seed script for production — creates the initial admin user.
 * Usage: bun scripts/seed-admin.ts
 *
 * Reads ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD from devEnv.
 */
import { Effect, Option } from "effect";
import * as Redacted from "effect/Redacted";
import { sql } from "kysely";
import { devEnv } from "./devEnv.js";
import { PgRootDB } from "../server/db.js";
import { serverRuntime } from "../server/runtime.js";

async function getRootDb() {
  return serverRuntime.runPromise(PgRootDB);
}

async function seedAdmin() {
  const username = devEnv.ADMIN_USERNAME;
  const email = devEnv.ADMIN_EMAIL;
  const name = devEnv.ADMIN_NAME ?? "Admin";
  const password = devEnv.ADMIN_PASSWORD;

  if (!username || !email || !password) {
    console.error("Required env vars: ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD");
    process.exit(1);
  }

  const rootDb = await getRootDb();
  const existing = await serverRuntime.runPromise(
    rootDb
      .selectFrom("app_public.users")
      .select("id")
      .where("username", "=", username)
      .pipe(Effect.head, Effect.option),
  );

  if (Option.isSome(existing)) {
    console.log(`Admin user '${username}' already exists, skipping.`);
    return;
  }

  const user = await serverRuntime.runPromise(
    rootDb
      .selectFrom(
        sql<{ id: string }>`
          app_private.create_user(
            ${username}::citext,
            ${email}::citext,
            ${name},
            'admin'::app_public.user_role
          )
        `.as("u"),
      )
      .select("id")
      .pipe(Effect.head),
  );

  await serverRuntime.runPromise(
    rootDb.selectNoFrom((eb) =>
      eb
        .fn<void>("app_private.set_password", [
          sql`${user.id}::uuid`,
          eb.val(Redacted.value(password)),
        ])
        .as("set_password"),
    ),
  );

  console.log(`Created admin user '${username}' (${email})`);
}

seedAdmin().catch((e) => {
  console.error("seed-admin failed:", e);
  process.exit(1);
});
