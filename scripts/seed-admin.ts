#!/usr/bin/env bun
/**
 * Seed script for production — creates the initial admin user.
 * Usage: bun scripts/seed-admin.ts
 *
 * Reads ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD from env.
 */
import { sql } from "kysely";
import { rootDb } from "../server/db.js";

async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const email = process.env.ADMIN_EMAIL;
  const name = process.env.ADMIN_NAME ?? "Admin";
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !email || !password) {
    console.error("Required env vars: ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD");
    process.exit(1);
  }

  const existing = await rootDb
    .selectFrom("app_public.users")
    .select("id")
    .where("username", "=", username)
    .executeTakeFirst();

  if (existing) {
    console.log(`Admin user '${username}' already exists, skipping.`);
    return;
  }

  const user = await rootDb
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
    .executeTakeFirstOrThrow();

  await sql`select app_private.set_password(${user.id}::uuid, ${password})`.execute(rootDb);

  console.log(`Created admin user '${username}' (${email})`);
}

seedAdmin().catch((e) => {
  console.error("seed-admin failed:", e);
  process.exit(1);
});
