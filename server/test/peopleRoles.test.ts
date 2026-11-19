import { it, expect, describe, beforeAll, afterAll } from "vitest";
import pg from "pg";

/**
 * app_public.set_user_role, called through the visitor role as a signed-in account. The HTTP
 * route for it is covered in api.test.ts; these cases pin the function's own refusals.
 */

let ownerPool: pg.Pool;
let visitorPool: pg.Pool;

const unique = (label: string) => `${label}_${Math.random().toString(36).slice(2, 10)}`;

async function createUser(username: string, role: string): Promise<string> {
  const r = await ownerPool.query<{ id: string }>(
    `select id from app_private.really_create_user($1::citext, $1, null, true, $2::citext, $3)`,
    [username, `${username.replace(/_/g, "-")}@test.com`, `${username}123`],
  );
  await ownerPool.query(`update app_public.users set role = $1 where id = $2`, [
    role,
    r.rows[0].id,
  ]);
  return r.rows[0].id;
}

async function sessionFor(userId: string): Promise<string> {
  const r = await ownerPool.query<{ id: string }>(
    `insert into app_private.sessions (user_id) values ($1) returning id`,
    [userId],
  );
  return r.rows[0].id;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function forceIpv4(urlString: string): string {
  const url = new URL(urlString);
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.toString();
}

/** Opens a visitor transaction as the session's user, and holds it open until `fn` returns. */
async function beginAsVisitor(sessionId: string): Promise<pg.PoolClient> {
  const client = await visitorPool.connect();
  await client.query("begin");
  await client.query(`set local role "${requiredEnv("DATABASE_VISITOR")}"`);
  await client.query("select set_config('my.session_id', $1, true)", [sessionId]);
  return client;
}

/** Runs `fn` as the session's user in a visitor transaction that commits, so deferred checks run. */
async function asVisitorCommitting<T>(
  sessionId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await beginAsVisitor(sessionId);
  try {
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Resolves once the given backend is blocked on a lock. pg_stat_activity hides wait events of
 * other roles' sessions, so this asks pg_blocking_pids, which any role can call.
 */
async function waitUntilWaitingOnLock(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const blocked = await ownerPool.query<{ blocked: boolean }>(
      "select cardinality(pg_blocking_pids($1)) > 0 as blocked",
      [pid],
    );
    if (blocked.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("backend never waited on a lock");
}

const setRole = (client: pg.PoolClient, userId: string, role: string) =>
  client.query(`select * from app_public.set_user_role($1::uuid, $2::app_public.user_role)`, [
    userId,
    role,
  ]);

describe("set_user_role", () => {
  let adminId: string;
  let adminSession: string;
  let teacherSession: string;
  let studentId: string;

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: forceIpv4(requiredEnv("DATABASE_URL")) });
    visitorPool = new pg.Pool({ connectionString: forceIpv4(requiredEnv("AUTH_DATABASE_URL")) });

    adminId = await createUser(unique("pr_admin"), "admin");
    adminSession = await sessionFor(adminId);
    const teacherId = await createUser(unique("pr_teacher"), "teacher");
    teacherSession = await sessionFor(teacherId);
    studentId = await createUser(unique("pr_student"), "student");
  }, 120_000);

  afterAll(async () => {
    await ownerPool?.end();
    await visitorPool?.end();
  }, 30_000);

  it("an admin sets another account's role", async () => {
    const row = await asVisitorCommitting(adminSession, (client) =>
      setRole(client, studentId, "parent").then((r) => r.rows[0]),
    );
    expect(row).toMatchObject({ id: studentId, role: "parent" });
    const stored = await ownerPool.query(`select role from app_public.users where id = $1`, [
      studentId,
    ]);
    expect(stored.rows[0].role).toBe("parent");
  });

  it("a teacher cannot set a role", async () => {
    await expect(
      asVisitorCommitting(teacherSession, (client) => setRole(client, studentId, "admin")),
    ).rejects.toMatchObject({
      code: "DNIED",
      message: expect.stringContaining("Only an admin"),
    });
  });

  it("an admin cannot change their own role", async () => {
    await expect(
      asVisitorCommitting(adminSession, (client) => setRole(client, adminId, "teacher")),
    ).rejects.toMatchObject({ code: "DNIED", message: "You cannot change your own role" });
  });

  it("a parent who is billing contact of a family with a student cannot leave the parent role", async () => {
    const parentId = await createUser(unique("pr_billing"), "parent");
    const kidId = await createUser(unique("pr_kid"), "student");
    const family = await ownerPool.query<{ id: string }>(
      `insert into app_public.families (slug, name) values ($1, 'Billing Family') returning id`,
      [unique("pr-family")],
    );
    const familyId = family.rows[0].id;
    await ownerPool.query(
      `insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
       values ($1, $2, true, true), ($1, $3, false, false)`,
      [familyId, parentId, kidId],
    );

    // The refusal comes from the deferred billing-contact trigger, so it surfaces at commit.
    await expect(
      asVisitorCommitting(adminSession, (client) => setRole(client, parentId, "teacher")),
    ).rejects.toMatchObject({ code: "BLCNT" });

    const stored = await ownerPool.query(`select role from app_public.users where id = $1`, [
      parentId,
    ]);
    expect(stored.rows[0].role).toBe("parent");
  });

  // The admin B is demoted by A in an open transaction. B's call, which demotes C, waits on the
  // admin-row lock. Once A commits, B is no longer an admin when its call reads its role, so the
  // call is refused and C stays an admin. The three admins are fixed here, so the outcome does
  // not depend on the admins other test files create.
  it("a call waiting on another demotion is refused once its caller is no longer an admin", async () => {
    const adminA = await createUser(unique("pr_race_a"), "admin");
    const adminB = await createUser(unique("pr_race_b"), "admin");
    const adminC = await createUser(unique("pr_race_c"), "admin");
    const sessionA = await sessionFor(adminA);
    const sessionB = await sessionFor(adminB);

    const first = await beginAsVisitor(sessionA);
    await setRole(first, adminB, "parent");

    const second = await beginAsVisitor(sessionB);
    const secondPid = (await second.query<{ pid: number }>("select pg_backend_pid() as pid"))
      .rows[0].pid;
    const secondResult = setRole(second, adminC, "student").then(
      () => "changed",
      (error: unknown) => error,
    );
    await waitUntilWaitingOnLock(secondPid);
    await first.query("commit");
    first.release();

    expect(await secondResult).toMatchObject({
      code: "DNIED",
      message: "Only an admin can change a role",
    });
    await second.query("rollback");
    second.release();

    const stored = await ownerPool.query(`select role from app_public.users where id = $1`, [
      adminC,
    ]);
    expect(stored.rows[0].role).toBe("admin");
  });
});
