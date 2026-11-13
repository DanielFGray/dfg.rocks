import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { emailVerifiedClaim } from "../services/oauth.js";

// These tests call app_private.link_or_register_user directly against the test
// database. Each test runs in a transaction that is rolled back.

let pool: pg.Pool;

function forceIpv4(urlString: string): string {
  const url = new URL(urlString);
  if (url.hostname === "localhost" || url.hostname === "::1") url.hostname = "127.0.0.1";
  return url.toString();
}

beforeAll(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required; run `bun run db:up`");
  pool = new pg.Pool({ connectionString: forceIpv4(url) });
});

afterAll(async () => {
  await pool.end();
});

async function inRolledBackTransaction<A>(fn: (db: pg.PoolClient) => Promise<A>): Promise<A> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    return await fn(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

// A failing statement aborts the transaction, so the error is caught inside a
// savepoint to let the test keep querying afterwards.
async function errorCodeOf(db: pg.PoolClient, text: string, params: unknown[]) {
  await db.query("savepoint attempt");
  try {
    await db.query(text, params);
    await db.query("release savepoint attempt");
    return undefined;
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    return error instanceof Error && "code" in error ? error.code : undefined;
  }
}

function freshEmail() {
  return `${randomUUID()}@example.test`;
}

async function createLocalUser(db: pg.PoolClient, email: string, emailVerified: boolean) {
  const username = `t${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const { rows } = await db.query<{ id: string }>(
    `select (app_private.really_create_user($1::citext, 'Local User', null, $3, $2, null)).id`,
    [username, email, emailVerified],
  );
  return rows[0].id;
}

function googleProfile(email: string, emailVerified: boolean) {
  return { sub: randomUUID(), email, email_verified: emailVerified, name: "Provider User" };
}

const linkGoogleSql = `select (app_private.link_or_register_user(null, 'google', $1, $2::json, '{}'::json)).id`;

async function linkedGoogleCount(db: pg.PoolClient, userId: string) {
  const { rows } = await db.query<{ count: string }>(
    `select count(*) from app_public.user_authentications where user_id = $1 and service = 'google'`,
    [userId],
  );
  return Number(rows[0].count);
}

async function emailIsVerified(db: pg.PoolClient, userId: string, email: string) {
  const { rows } = await db.query<{ is_verified: boolean }>(
    `select is_verified from app_public.user_emails where user_id = $1 and email = $2::citext`,
    [userId, email],
  );
  return rows[0].is_verified;
}

describe("OAuth sign-in links by email only when the provider verified it", () => {
  it("links a verified provider email to the existing verified local account", () =>
    inRolledBackTransaction(async (db) => {
      const email = freshEmail();
      const localUserId = await createLocalUser(db, email, true);
      const profile = googleProfile(email, true);

      const { rows } = await db.query<{ id: string }>(linkGoogleSql, [
        profile.sub,
        JSON.stringify(profile),
      ]);

      expect(rows[0].id).toBe(localUserId);
      expect(await linkedGoogleCount(db, localUserId)).toBe(1);
    }));

  it("does not link an unverified provider email; the sign-in is rejected and nothing is linked", () =>
    inRolledBackTransaction(async (db) => {
      const email = freshEmail();
      const localUserId = await createLocalUser(db, email, true);
      const profile = googleProfile(email, false);

      // Registering a second account on a verified address trips the
      // `_200_forbid_existing_email` trigger (errcode EMTKN).
      const code = await errorCodeOf(db, linkGoogleSql, [profile.sub, JSON.stringify(profile)]);

      expect(code).toBe("EMTKN");
      expect(await linkedGoogleCount(db, localUserId)).toBe(0);
    }));

  it("registers a provider-verified email as verified", () =>
    inRolledBackTransaction(async (db) => {
      const email = freshEmail();
      const profile = googleProfile(email, true);

      const { rows } = await db.query<{ id: string }>(linkGoogleSql, [
        profile.sub,
        JSON.stringify(profile),
      ]);

      expect(await emailIsVerified(db, rows[0].id, email)).toBe(true);
    }));

  it("registers an unverified provider email as unverified", () =>
    inRolledBackTransaction(async (db) => {
      const email = freshEmail();
      const profile = googleProfile(email, false);

      const { rows } = await db.query<{ id: string }>(linkGoogleSql, [
        profile.sub,
        JSON.stringify(profile),
      ]);

      expect(await emailIsVerified(db, rows[0].id, email)).toBe(false);
    }));
});

describe("emailVerifiedClaim", () => {
  it.each([
    [true, true],
    ["true", true],
    [false, false],
    ["false", false],
    [undefined, false],
    ["yes", false],
  ])("reads %p as %p", (claim, expected) => {
    expect(emailVerifiedClaim(claim)).toBe(expected);
  });
});
