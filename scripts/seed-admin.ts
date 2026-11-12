#!/usr/bin/env bun
/**
 * Seed script for production — creates the initial admin user.
 * Usage: bun scripts/seed-admin.ts
 *
 * Reads ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD and optional ADMIN_NAME.
 */
import { Config, Effect, Option } from "effect";
import * as Redacted from "effect/Redacted";
import { sql } from "kysely";
import { PgRootDB } from "../server/db.js";

const seedAdmin = Effect.gen(function* () {
  const username = yield* Config.NonEmptyString("ADMIN_USERNAME");
  const email = yield* Config.NonEmptyString("ADMIN_EMAIL");
  const name = yield* Config.NonEmptyString("ADMIN_NAME").pipe(Config.withDefault("Admin"));
  const password = yield* Config.Redacted("ADMIN_PASSWORD");
  const rootDb = yield* PgRootDB;

  const existing = yield* rootDb
    .execute(rootDb.selectFrom("app_public.users").select("id").where("username", "=", username))
    .pipe(Effect.head, Effect.option);
  if (Option.isSome(existing)) {
    yield* Effect.log(`Admin user '${username}' already exists, skipping.`);
    return;
  }

  const user = yield* rootDb
    .execute(
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
        .select("id"),
    )
    .pipe(Effect.head);

  yield* rootDb.execute(
    rootDb.selectNoFrom((eb) =>
      eb
        .fn<void>("app_private.set_password", [
          sql`${user.id}::uuid`,
          eb.val(Redacted.value(password)),
        ])
        .as("set_password"),
    ),
  );

  yield* Effect.log(`Created admin user '${username}' (${email})`);
});

Effect.runPromise(seedAdmin.pipe(Effect.provide(PgRootDB.layer))).catch((e) => {
  console.error("seed-admin failed:", e);
  process.exit(1);
});
