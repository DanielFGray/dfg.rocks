#!/usr/bin/env bun
/**
 * Seed script for production — creates the initial admin user.
 * Usage: bun scripts/seed-admin.ts
 *
 * Reads ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD from env.
 */
import { Effect } from "effect";
import { sql } from "kysely";
import { PgRootDB } from "../server/db.js";

const seedAdmin = Effect.gen(function* () {
  const db = yield* PgRootDB;

  const username = process.env.ADMIN_USERNAME;
  const email = process.env.ADMIN_EMAIL;
  const name = process.env.ADMIN_NAME ?? "Admin";
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !email || !password) {
    console.error("Required env vars: ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD");
    process.exit(1);
  }

  // Check if admin already exists
  const existing = yield* db
    .selectFrom("app_public.users")
    .select("id")
    .where("username", "=", username)
    .pipe(
      Effect.head,
      Effect.catchTag("NoSuchElementException", () => Effect.succeed(null)),
    );

  if (existing) {
    console.log(`Admin user '${username}' already exists, skipping.`);
    return;
  }

  // Create user
  const user = yield* db
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
    .pipe(Effect.head, Effect.orDie);

  // Set password
  yield* db.selectNoFrom([
    sql`app_private.set_password(${user.id}::uuid, ${password})`.as("_"),
  ]);

  console.log(`Created admin user '${username}' (${email})`);
});

seedAdmin.pipe(
  Effect.provide(PgRootDB.Live),
  Effect.orDie,
  Effect.runPromise,
);
