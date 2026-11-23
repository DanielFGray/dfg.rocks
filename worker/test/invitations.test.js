// @ts-check
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import pg from "pg";
import { WorkerJobs } from "../worker.ts";
import { jobRun, workerTestRuntime } from "./jobs.ts";
import { testDatabaseEnv } from "../../scripts/testDatabase.ts";

// The account invitation email: its link must carry the token that claim_account_invitation
// accepts at the moment the job runs.

const runtime = workerTestRuntime();
const pool = new pg.Pool({ connectionString: testDatabaseEnv().DATABASE_URL });
const suffix = () => crypto.randomUUID().replaceAll("-", "").slice(0, 10);
/** @type {string[]} */
const userIds = [];
/** @type {string} */
let adminSession;

beforeAll(async () => {
  const admin = await pool.query(
    "select id from app_private.really_create_user($1::citext, 'Teacher Tess', null, true, $2::citext, 'testpass')",
    [`inv_admin_${suffix()}`, `inv-admin-${suffix()}@example.invalid`],
  );
  userIds.push(admin.rows[0].id);
  await pool.query("update app_public.users set role = 'admin' where id = $1", [admin.rows[0].id]);
  const session = await pool.query(
    "insert into app_private.sessions (user_id) values ($1) returning id",
    [admin.rows[0].id],
  );
  adminSession = session.rows[0].id;
});

afterAll(async () => {
  await pool.query("delete from app_public.users where id = any($1)", [userIds]);
  await runtime.dispose();
  await pool.end();
});

/** Invites a new account as the admin, the way the staff form does. */
async function invite(/** @type {string} */ email) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('my.session_id', $1, true)", [adminSession]);
    const user = await client.query(
      "select id from app_public.invite_account('Invited Ivy', $1::citext, 'student', null, 'See you Tuesday')",
      [email],
    );
    await client.query("commit");
    userIds.push(user.rows[0].id);
    const invitation = await pool.query(
      "select id from app_public.family_invitations where user_id = $1 and family_id is null",
      [user.rows[0].id],
    );
    return { userId: user.rows[0].id, invitationId: invitation.rows[0].id };
  } finally {
    client.release();
  }
}

const currentToken = async (/** @type {string} */ email) =>
  (
    await pool.query(
      "select s.verification_token from app_public.user_emails e join app_private.user_email_secrets s on s.user_email_id = e.id where e.email = $1::citext",
      [email],
    )
  ).rows[0].verification_token;

/** Runs the job graphile runs for the invitation, and returns the emails it queued. */
async function sendInvite(/** @type {string} */ invitationId, /** @type {string} */ email) {
  await runtime.runPromise(
    WorkerJobs.use((jobs) =>
      Effect.promise(() =>
        jobs.family_invitations__send_invite(
          { id: invitationId },
          jobRun("family_invitations__send_invite"),
        ),
      ),
    ),
  );
  const sent = await pool.query(
    "delete from graphile_worker._private_jobs jobs using graphile_worker._private_tasks tasks where tasks.id = jobs.task_id and tasks.identifier = 'send_email' and jobs.payload -> 'options' ->> 'to' = $1 returning jobs.payload",
    [email],
  );
  return sent.rows.map((row) => row.payload);
}

/** @param {any} payload */
const linkIn = (payload) => new URL(payload.variables.loginLink);

describe("account invitation email", () => {
  test("carries the message and a link with the invitation id and current token", async () => {
    const email = `inv-${suffix()}@example.invalid`;
    const { invitationId } = await invite(email);
    const [mail, ...rest] = await sendInvite(invitationId, email);
    expect(rest).toEqual([]);
    expect(mail).toMatchObject({
      template: "account_invitation.mjml",
      options: { subject: "Teacher Tess invited you to DFG Portal" },
      variables: {
        inviteeName: "Invited Ivy",
        inviterName: "Teacher Tess",
        message: "See you Tuesday",
      },
    });
    const link = linkIn(mail);
    expect(link.pathname).toBe("/invite");
    expect(link.searchParams.get("id")).toBe(invitationId);
    expect(link.searchParams.get("token")).toBe(await currentToken(email));
  });

  test("after a resend, carries the new token", async () => {
    const email = `inv-${suffix()}@example.invalid`;
    const { invitationId } = await invite(email);
    const first = linkIn((await sendInvite(invitationId, email))[0]).searchParams.get("token");

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('my.session_id', $1, true)", [adminSession]);
      await client.query("select app_public.resend_account_invitation($1)", [invitationId]);
      await client.query("commit");
    } finally {
      client.release();
    }
    const second = linkIn((await sendInvite(invitationId, email))[0]).searchParams.get("token");
    expect(second).not.toBe(first);
    expect(second).toBe(await currentToken(email));
  });

  test("sends nothing once the account is claimed or the invitation expired", async () => {
    const claimedEmail = `inv-${suffix()}@example.invalid`;
    const claimed = await invite(claimedEmail);
    await pool.query("select app_private.claim_account_invitation($1, $2)", [
      claimed.invitationId,
      await currentToken(claimedEmail),
    ]);
    expect(await sendInvite(claimed.invitationId, claimedEmail)).toEqual([]);

    const expiredEmail = `inv-${suffix()}@example.invalid`;
    const expired = await invite(expiredEmail);
    await pool.query(
      "update app_public.family_invitations set expires_at = now() - interval '1 minute' where id = $1",
      [expired.invitationId],
    );
    expect(await sendInvite(expired.invitationId, expiredEmail)).toEqual([]);
  });
});
