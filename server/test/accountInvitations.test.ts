import { it, expect, describe, beforeAll, afterAll } from "vitest";
import pg from "pg";

/**
 * app_public.invite_account, app_public.resend_account_invitation and
 * app_private.claim_account_invitation: staff create an account, and the invited address's
 * token logs it in once. The page flow is covered in e2e/invitations.spec.ts.
 */

let ownerPool: pg.Pool;
let visitorPool: pg.Pool;

const unique = (label: string) => `${label}_${Math.random().toString(36).slice(2, 10)}`;

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

async function createUser(role: string): Promise<string> {
  const username = unique(`ai_${role}`);
  const r = await ownerPool.query<{ id: string }>(
    `select id from app_private.really_create_user($1::citext, $1, null, true, $2::citext, 'password123')`,
    [username, `${username.replace(/_/g, "-")}@test.com`],
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

/** Runs one committed visitor transaction as the session's user. */
async function asVisitor<T>(sessionId: string, sql: string, params: unknown[]): Promise<T> {
  const client = await visitorPool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role "${requiredEnv("DATABASE_VISITOR")}"`);
    await client.query("select set_config('my.session_id', $1, true)", [sessionId]);
    const result = await client.query(sql, params);
    await client.query("commit");
    return result.rows[0] as T;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const invite = (
  sessionId: string,
  values: { name: string; email: string; role?: string; familyId?: string; message?: string },
) =>
  asVisitor<{ id: string; username: string; role: string }>(
    sessionId,
    `select id, username, role from app_public.invite_account($1, $2::citext, $3::app_public.user_role, $4::uuid, $5)`,
    [
      values.name,
      values.email,
      values.role ?? "student",
      values.familyId ?? null,
      values.message ?? null,
    ],
  );

async function invitationFor(userId: string) {
  const r = await ownerPool.query<{ id: string; token: string | null; message: string | null }>(
    `select i.id, s.verification_token as token, i.message
       from app_public.family_invitations i
       join app_public.user_emails e on e.user_id = i.user_id
       join app_private.user_email_secrets s on s.user_email_id = e.id
      where i.user_id = $1 and i.family_id is null`,
    [userId],
  );
  return r.rows[0];
}

async function claim(invitationId: string, token: string) {
  const r = await ownerPool.query<{ id: string | null }>(
    `select (app_private.claim_account_invitation($1, $2)).id`,
    [invitationId, token],
  );
  return r.rows[0].id;
}

async function queuedJobs(payloadId: string) {
  const r = await ownerPool.query<{ task_identifier: string }>(
    `select t.identifier as task_identifier
       from graphile_worker._private_jobs j
       join graphile_worker._private_tasks t on t.id = j.task_id
      where j.payload->>'id' = $1
      order by j.id`,
    [payloadId],
  );
  return r.rows.map((row) => row.task_identifier);
}

describe("account invitations", () => {
  let adminSession: string;
  let teacherSession: string;
  let studentSession: string;

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: forceIpv4(requiredEnv("DATABASE_URL")) });
    visitorPool = new pg.Pool({ connectionString: forceIpv4(requiredEnv("AUTH_DATABASE_URL")) });
    adminSession = await sessionFor(await createUser("admin"));
    teacherSession = await sessionFor(await createUser("teacher"));
    studentSession = await sessionFor(await createUser("student"));
  }, 120_000);

  afterAll(async () => {
    await ownerPool?.end();
    await visitorPool?.end();
  }, 30_000);

  it("creates the account at once and queues only the invitation email", async () => {
    const email = `${unique("jane")}@test.local`;
    const user = await invite(adminSession, {
      name: "Zoë Invite",
      email,
      role: "parent",
      message: "  Hi!  ",
    });
    expect(user).toMatchObject({ role: "parent" });
    expect(user.username).toMatch(/^Zoe_Invite\d*$/);

    const address = await ownerPool.query(
      `select id, is_verified, is_primary from app_public.user_emails where user_id = $1`,
      [user.id],
    );
    expect(address.rows).toEqual([
      expect.objectContaining({ is_verified: false, is_primary: false }),
    ]);
    const invitation = await invitationFor(user.id);
    expect(invitation.message).toBe("Hi!");
    expect(invitation.token).toMatch(/^[0-9a-f]{64}$/);

    expect(await queuedJobs(invitation.id)).toEqual(["family_invitations__send_invite"]);
    expect(await queuedJobs(address.rows[0].id)).toEqual([]);
  });

  it("lets a teacher invite and refuses a student", async () => {
    await expect(
      invite(teacherSession, { name: "Taught", email: `${unique("t")}@test.local` }),
    ).resolves.toMatchObject({ role: "student" });
    await expect(
      invite(studentSession, { name: "Nope", email: `${unique("s")}@test.local` }),
    ).rejects.toMatchObject({ code: "DNIED" });
  });

  it("refuses an address any account holds, verified or not", async () => {
    const email = `${unique("dup")}@test.local`;
    await invite(adminSession, { name: "First", email });
    await expect(
      invite(adminSession, { name: "Second", email: email.toUpperCase() }),
    ).rejects.toMatchObject({ code: "EMTKN" });
  });

  it("adds the account to the chosen family, under the family's rules", async () => {
    const family = await ownerPool.query<{ id: string }>(
      `insert into app_public.families (slug, name) values ($1, 'Invite Family') returning id`,
      [unique("ai-family").replace(/_/g, "-")],
    );
    const familyId = family.rows[0].id;
    const kid = { name: "Family Kid", email: `${unique("kid")}@test.local`, familyId };
    await expect(invite(adminSession, kid)).rejects.toMatchObject({ code: "BLCNT" });

    const parent = await invite(adminSession, {
      name: "Family Parent",
      email: `${unique("parent")}@test.local`,
      role: "parent",
      familyId,
    });
    const student = await invite(adminSession, kid);
    const members = await ownerPool.query(
      `select user_id, is_billing_contact from app_public.family_memberships where family_id = $1`,
      [familyId],
    );
    expect(members.rows).toEqual(
      expect.arrayContaining([
        { user_id: parent.id, is_billing_contact: true },
        { user_id: student.id, is_billing_contact: false },
      ]),
    );
  });

  it("claims once with the right token, and verifies only that address", async () => {
    const user = await invite(adminSession, {
      name: "Claimer",
      email: `${unique("c")}@test.local`,
    });
    const { id, token } = await invitationFor(user.id);
    expect(await claim(id, "not-the-token")).toBeNull();
    expect(await claim(id, token!)).toBe(user.id);

    const state = await ownerPool.query(
      `select u.is_verified as account, e.is_verified as address, e.is_primary
         from app_public.users u join app_public.user_emails e on e.user_id = u.id
        where u.id = $1`,
      [user.id],
    );
    expect(state.rows).toEqual([{ account: true, address: true, is_primary: true }]);
    expect(await claim(id, token!)).toBeNull();
  });

  it("refuses an expired link", async () => {
    const user = await invite(adminSession, {
      name: "Late",
      email: `${unique("late")}@test.local`,
    });
    const { id, token } = await invitationFor(user.id);
    await ownerPool.query(
      `update app_public.family_invitations set expires_at = now() - interval '1 minute' where id = $1`,
      [id],
    );
    expect(await claim(id, token!)).toBeNull();
  });

  it("resends with a new token and refuses once the account is claimed", async () => {
    const user = await invite(adminSession, { name: "Resent", email: `${unique("r")}@test.local` });
    const before = await invitationFor(user.id);
    await asVisitor(adminSession, `select app_public.resend_account_invitation($1)`, [before.id]);
    const after = await invitationFor(user.id);
    expect(after.token).not.toEqual(before.token);
    expect(await queuedJobs(before.id)).toEqual([
      "family_invitations__send_invite",
      "family_invitations__send_invite",
    ]);
    expect(await claim(before.id, before.token!)).toBeNull();
    expect(await claim(after.id, after.token!)).toBe(user.id);
    await expect(
      asVisitor(adminSession, `select app_public.resend_account_invitation($1)`, [before.id]),
    ).rejects.toMatchObject({ code: "NTFND" });
  });
});
