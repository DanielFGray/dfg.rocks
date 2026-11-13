import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import pg from "pg";
import { WorkerJobs } from "../worker.ts";
import { AuditEvent } from "../accountMail.ts";
import { jobRun, workerTestRuntime } from "./jobs.ts";
import { testDatabaseEnv } from "../../scripts/testDatabase.ts";

const runtime = workerTestRuntime();
const pool = new pg.Pool({ connectionString: testDatabaseEnv().DATABASE_URL });
let userId;
let email;
beforeAll(async () => {
  email = `worker_audit_${crypto.randomUUID()}@example.invalid`;
  const created = await pool.query(
    "select id from app_private.really_create_user($1::citext, 'Audit Player', null, true, $2::citext, 'testpass')",
    [`audit_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`, email],
  );
  userId = created.rows[0].id;
});
afterAll(async () => {
  if (userId) await pool.query("delete from app_public.users where id = $1", [userId]);
  await runtime.dispose();
  await pool.end();
});
const cases = [
  ["added_email", "You added the email 'other@example.invalid' to your account."],
  ["removed_email", "You removed the email 'other@example.invalid' from your account."],
  ["linked_account", "You linked a third-party OAuth provider ('google') to your account."],
  [
    "unlinked_account",
    "You removed a link between your account and a third-party OAuth provider ('google').",
  ],
  ["reset_password", "You reset your password."],
  ["change_password", "You changed your password."],
];
describe("security audit mail", () => {
  for (const [type, description] of cases) {
    test(type + " queues security mail through the registered decoder", async () => {
      const queuedAt = new Date(Date.now() + 60_000);
      const payload = type.endsWith("password")
        ? { type, user_id: userId }
        : { type, user_id: userId, extra1: "google", extra2: "other@example.invalid" };
      await runtime.runPromise(
        WorkerJobs.use((jobs) =>
          Effect.promise(() => jobs.user__audit(payload, jobRun("user__audit", queuedAt))),
        ),
      );
      const result = await pool.query(
        "select jobs.id, jobs.payload from graphile_worker._private_jobs jobs join graphile_worker._private_tasks tasks on tasks.id = jobs.task_id where tasks.identifier = 'send_email' and (jobs.payload -> 'options' -> 'to')::jsonb @> $1::jsonb and jobs.payload -> 'variables' ->> 'eventDescription' = $2",
        [JSON.stringify([email]), description],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].payload.variables).toMatchObject({
        userName: "Audit Player",
        eventDescription: description,
        eventTime: queuedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
      });
      await pool.query("delete from graphile_worker._private_jobs where id = $1", [
        result.rows[0].id,
      ]);
    });
  }

  test("OAuth sign-in that links a verified email queues an audit event for that user", async () => {
    const identifier = `audit_${crypto.randomUUID()}`;
    await pool.query(
      "select app_private.link_or_register_user(null, 'google', $1, json_build_object('email', $2::text), '{}'::json)",
      [identifier, email],
    );
    const queued = await pool.query(
      "select jobs.id, jobs.payload from graphile_worker._private_jobs jobs join graphile_worker._private_tasks tasks on tasks.id = jobs.task_id where tasks.identifier = 'user__audit' and jobs.payload ->> 'extra2' = $1",
      [identifier],
    );
    expect(queued.rows).toHaveLength(1);
    await pool.query("delete from graphile_worker._private_jobs where id = $1", [queued.rows[0].id]);
    expect(Schema.decodeUnknownSync(AuditEvent)(queued.rows[0].payload)).toMatchObject({
      type: "linked_account",
      user_id: userId,
    });
  });
});
