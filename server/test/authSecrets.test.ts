import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";

// These tests call the SQL auth functions directly. Each test runs inside a
// transaction that is rolled back, so no rows survive the test.

let pool: pg.Pool;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function forceIpv4(urlString: string): string {
  const url = new URL(urlString);
  if (url.hostname === "localhost" || url.hostname === "::1") url.hostname = "127.0.0.1";
  return url.toString();
}

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

// A failing statement aborts the whole transaction, so the error is caught
// inside a savepoint to let the test keep querying afterwards.
async function errorMessageOf(db: pg.PoolClient, text: string, params: unknown[]) {
  await db.query("savepoint attempt");
  try {
    await db.query(text, params);
    await db.query("release savepoint attempt");
    return null;
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    return error instanceof Error ? error.message : String(error);
  }
}

// Passing null as the password creates the OAuth-style account: no password_hash.
async function createUser(db: pg.PoolClient, password: string | null) {
  const username = `t${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const { rows } = await db.query<{ id: string }>(
    `select (app_private.really_create_user($1::citext, 'Test User', null, true, null, $2)).id`,
    [username, password],
  );
  return { id: rows[0].id, username };
}

async function login(db: pg.PoolClient, username: string, password: string) {
  const { rows } = await db.query<{ session_id: string | null }>(
    `select (app_private.login($1::citext, $2)).id as session_id`,
    [username, password],
  );
  return rows[0].session_id;
}

async function passwordHashIsNull(db: pg.PoolClient, userId: string) {
  const { rows } = await db.query<{ no_hash: boolean }>(
    `select password_hash is null as no_hash from app_private.user_secrets where user_id = $1`,
    [userId],
  );
  return rows[0].no_hash;
}

async function setPendingResetToken(db: pg.PoolClient, userId: string, token: string) {
  await db.query(
    `update app_private.user_secrets
       set reset_password_token = $2, reset_password_token_generated = now()
     where user_id = $1`,
    [userId, token],
  );
}

beforeAll(() => {
  pool = new pg.Pool({ connectionString: forceIpv4(requiredEnv("DATABASE_URL")) });
});

afterAll(async () => {
  await pool?.end();
});

describe("app_private.login", () => {
  it("rejects any password for an account with no password hash", () =>
    inRolledBackTransaction(async (db) => {
      const user = await createUser(db, null);

      expect(await login(db, user.username, "anything")).toBeNull();
    }));

  it("accepts the correct password and rejects a wrong one", () =>
    inRolledBackTransaction(async (db) => {
      const user = await createUser(db, "correct-password");

      expect(await login(db, user.username, "wrong-password")).toBeNull();
      expect(await login(db, user.username, "correct-password")).not.toBeNull();
    }));
});

describe("app_private.reset_password", () => {
  it("rejects a token when no reset is pending", () =>
    inRolledBackTransaction(async (db) => {
      const user = await createUser(db, "old-password");

      const { rows } = await db.query<{ session_id: string | null }>(
        `select (app_private.reset_password($1, 'any-token', 'attacker-password')).id as session_id`,
        [user.id],
      );

      expect(rows[0].session_id).toBeNull();
      expect(await login(db, user.username, "attacker-password")).toBeNull();
      expect(await login(db, user.username, "old-password")).not.toBeNull();
    }));

  it("rejects a null token when a reset is pending", () =>
    inRolledBackTransaction(async (db) => {
      const user = await createUser(db, "old-password");
      await setPendingResetToken(db, user.id, "reset-token");

      const { rows } = await db.query<{ session_id: string | null }>(
        `select (app_private.reset_password($1, null, 'attacker-password')).id as session_id`,
        [user.id],
      );

      expect(rows[0].session_id).toBeNull();
      expect(await login(db, user.username, "attacker-password")).toBeNull();
      expect(await login(db, user.username, "old-password")).not.toBeNull();
    }));

  it("rejects a matching token older than its 3-day lifetime", () =>
    inRolledBackTransaction(async (db) => {
      const user = await createUser(db, "old-password");
      await setPendingResetToken(db, user.id, "reset-token");
      await db.query(
        `update app_private.user_secrets
           set reset_password_token_generated = now() - interval '3 days 1 minute'
         where user_id = $1`,
        [user.id],
      );

      const { rows } = await db.query<{ session_id: string | null }>(
        `select (app_private.reset_password($1, 'reset-token', 'new-password')).id as session_id`,
        [user.id],
      );

      expect(rows[0].session_id).toBeNull();
      expect(await login(db, user.username, "new-password")).toBeNull();
      expect(await login(db, user.username, "old-password")).not.toBeNull();
    }));

  it("accepts the pending token and sets the new password", () =>
    inRolledBackTransaction(async (db) => {
      const user = await createUser(db, "old-password");
      await setPendingResetToken(db, user.id, "reset-token");

      const { rows } = await db.query<{ session_id: string | null }>(
        `select (app_private.reset_password($1, 'reset-token', 'new-password')).id as session_id`,
        [user.id],
      );

      expect(rows[0].session_id).not.toBeNull();
      expect(await login(db, user.username, "new-password")).not.toBeNull();
    }));
});

describe("app_public.change_password", () => {
  it("rejects any old password for an account with no password hash", () =>
    inRolledBackTransaction(async (db) => {
      const user = await createUser(db, null);
      const { rows } = await db.query<{ id: string }>(
        `insert into app_private.sessions (user_id) values ($1) returning id`,
        [user.id],
      );
      await db.query(`select set_config('my.session_id', $1, true)`, [rows[0].id]);

      const message = await errorMessageOf(
        db,
        `select app_public.change_password('anything', 'attacker-password')`,
        [],
      );

      expect(message).toBe("Incorrect password");
      expect(await passwordHashIsNull(db, user.id)).toBe(true);
    }));

  it("accepts the correct old password and sets the new one", () =>
    inRolledBackTransaction(async (db) => {
      const user = await createUser(db, "old-password");
      const sessionId = await login(db, user.username, "old-password");
      await db.query(`select set_config('my.session_id', $1, true)`, [sessionId]);

      const { rows } = await db.query<{ changed: boolean }>(
        `select app_public.change_password('old-password', 'new-password') as changed`,
      );

      expect(rows[0].changed).toBe(true);
      expect(await login(db, user.username, "new-password")).not.toBeNull();
    }));
});

describe("app_private.set_child_password", () => {
  it("rejects a null token when a reset is pending", () =>
    inRolledBackTransaction(async (db) => {
      const child = await createUser(db, null);
      await db.query(
        `update app_private.user_secrets
           set child_password_reset_token = 'child-token',
               child_password_reset_token_generated = now()
         where user_id = $1`,
        [child.id],
      );

      const message = await errorMessageOf(
        db,
        `select app_private.set_child_password($1, null, 'attacker-password')`,
        [child.id],
      );

      expect(message).toBe("Invalid reset token");
      expect(await passwordHashIsNull(db, child.id)).toBe(true);
    }));

  it("accepts the pending token and sets the new password", () =>
    inRolledBackTransaction(async (db) => {
      const child = await createUser(db, null);
      await db.query(
        `update app_private.user_secrets
           set child_password_reset_token = 'child-token',
               child_password_reset_token_generated = now()
         where user_id = $1`,
        [child.id],
      );

      await db.query(`select app_private.set_child_password($1, 'child-token', 'new-password')`, [
        child.id,
      ]);

      expect(await login(db, child.username, "new-password")).not.toBeNull();
    }));
});
