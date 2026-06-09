import { it, expect, describe, beforeAll, afterAll, vi } from "@effect/vitest";
import * as Command from "@effect/platform/Command";
import * as FileSystem from "@effect/platform/FileSystem";
import * as NodeContext from "@effect/platform-node/NodeContext";
import pg from "pg";
import { Effect } from "effect";
import { Logger, consoleLogFactory, type Job } from "graphile-worker";
import { loadEnvFile } from "process";

let handler: (request: Request) => Promise<Response>;
let testDb: pg.Client;
let adminCookie: string;
let studentCookie: string;
let studentId: string;

const testApplePrivateKey = "-----BEGIN PRIVATE KEY-----\\nAQAB\\n-----END PRIVATE KEY-----";

loadEnvFile();

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function withDatabaseSuffix(connectionString: string, suffix: string): string {
  const url = new URL(connectionString);
  const databaseName = url.pathname.replace(/^\/+/, "");
  if (!databaseName)
    throw new Error(`Connection string is missing a database name: ${connectionString}`);
  url.pathname = `/${databaseName}${suffix}`;
  return url.toString();
}

function forceIpv4(urlString: string): string {
  const url = new URL(urlString);
  if (url.hostname === "localhost" || url.hostname === "::1") url.hostname = "127.0.0.1";
  return url.toString();
}

function runPlatform<A, E>(effect: Effect.Effect<A, E, NodeContext.NodeContext>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));
}

const runCommand = Effect.fnUntraced(function* (
  command: string,
  args: ReadonlyArray<string>,
  environment: Record<string, string>,
) {
  const exitCode = yield* Command.make(command, ...args).pipe(
    Command.env(environment),
    Command.workingDirectory(process.cwd()),
    Command.exitCode,
  );
  if (exitCode !== 0)
    throw new Error(`Command failed (${exitCode}): ${[command, ...args].join(" ")}`);
});

const TEST_ROOT_URL = "http://127.0.0.1:3000";
type TitledItem = { title: string };
type SubmissionSummary = { id: string; email: string; is_read: boolean };
type StudentSummary = { username: string };

function req(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; csrf?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.csrf !== false) headers["X-Requested-With"] = "dfg";
  if (opts.cookie) headers["Cookie"] = `session=${opts.cookie}`;
  const body =
    opts.body instanceof FormData
      ? opts.body
      : opts.body !== undefined
        ? ((headers["Content-Type"] = "application/json"), JSON.stringify(opts.body))
        : undefined;
  return handler(new Request(`${TEST_ROOT_URL}${path}`, { method, headers, body }));
}

function getCookie(res: Response): string | null {
  const header = res.headers.get("set-cookie");
  if (!header) return null;
  const match = header.match(/session=([^;]+)/);
  return match?.[1] ?? null;
}

function cookieIdFromToken(token: string): string {
  return token.split(".")[0] ?? "";
}

function reqEffect(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; csrf?: boolean } = {},
) {
  return Effect.tryPromise(() => req(method, path, opts));
}

describe("DFG Portal API", () => {
  beforeAll(async () => {
    const dbUrl = forceIpv4(withDatabaseSuffix(requiredEnv("DATABASE_URL"), "_test"));
    const authDbUrl = forceIpv4(withDatabaseSuffix(requiredEnv("AUTH_DATABASE_URL"), "_test"));
    const viteRootUrl = forceIpv4(process.env.VITE_ROOT_URL || "http://localhost:5174");
    const adminEmail = process.env.ADMIN_EMAIL || "admin@test.com";
    const childEnv = Object.fromEntries(
      Object.entries({
        ...process.env,
        DATABASE_URL: dbUrl,
        AUTH_DATABASE_URL: authDbUrl,
        ROOT_DATABASE_URL: forceIpv4(process.env.ROOT_DATABASE_URL || ""),
        DATABASE_HOST: "127.0.0.1",
        NOCONFIRM: "1",
        NODE_ENV: "test",
        PORT: "0",
        VITE_ROOT_URL: viteRootUrl,
        ADMIN_EMAIL: adminEmail,
        GOOGLE_CALENDAR_CLIENT_ID: process.env.GOOGLE_CALENDAR_CLIENT_ID || "gcal-client-id",
        GOOGLE_CALENDAR_CLIENT_SECRET:
          process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "gcal-client-secret",
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "google-client-id",
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "google-client-secret",
        APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID || "apple-client-id",
        APPLE_TEAM_ID: process.env.APPLE_TEAM_ID || "apple-team-id",
        APPLE_KEY_ID: process.env.APPLE_KEY_ID || "apple-key-id",
        APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY || testApplePrivateKey,
      }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );

    await runPlatform(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.makeDirectory("generated", { recursive: true });
        yield* runCommand("bun", ["-b", "graphile-migrate", "reset", "--erase"], childEnv);
        yield* runCommand(
          "bun",
          ["-b", "--cwd=worker", "graphile-worker", "--schema-only"],
          childEnv,
        );
        yield* runCommand("bun", ["-b", "graphile-migrate", "watch", "--once"], childEnv);
      }),
    );

    Object.assign(process.env, childEnv);
    vi.resetModules();

    const { disableRateLimiting } = await import("../services/rateLimiter.js");
    disableRateLimiting();

    testDb = new pg.Client({ connectionString: dbUrl });
    await testDb.connect();
    const adminResult = await testDb.query(
      `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
      ["admin", "Test Admin", "admin@test.com", "admin123"],
    );
    await testDb.query(`update app_public.users set role = 'admin' where id = $1`, [
      adminResult.rows[0].id,
    ]);

    const { handleApiRequest } = await import("../app.js");
    handler = handleApiRequest;

    const adminLoginRes = await req("POST", "/api/login", {
      body: { id: "admin", password: "admin123" },
    });
    adminCookie = getCookie(adminLoginRes)!;
    if (!adminCookie)
      throw new Error(
        `Admin login failed (${adminLoginRes.status}): ${await adminLoginRes.text()}`,
      );

    const studentResult = await testDb.query(
      `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
      ["student1", "Test Student", "student1@test.com", "student123"],
    );
    studentId = studentResult.rows[0].id;

    const studentLoginRes = await req("POST", "/api/login", {
      body: { id: "student1", password: "student123" },
    });
    studentCookie = getCookie(studentLoginRes)!;
    if (!studentCookie)
      throw new Error(
        `Student login failed (${studentLoginRes.status}): ${await studentLoginRes.text()}`,
      );
  }, 120_000);

  afterAll(async () => {
    try {
      const { disposeApiHandler } = await import("../app.js");
      await disposeApiHandler();
    } catch {}
    await testDb?.end();
  }, 30_000);

  it.effect("public: health check and contact form", () =>
    Effect.gen(function* () {
      const health = yield* reqEffect("GET", "/api/health");
      expect(health.status).toBe(200);
      expect(yield* Effect.tryPromise(() => health.json())).toEqual({ success: true });

      const contact = yield* reqEffect("POST", "/api/contact", {
        body: {
          name: "Jane Doe",
          email: "jane@example.com",
          instrument: "piano",
          format: "in-person",
          message: "Looking for lessons",
        },
      });
      expect(contact.status).toBe(200);
      expect(yield* Effect.tryPromise(() => contact.json())).toEqual({ success: true });

      const spam = yield* reqEffect("POST", "/api/contact", {
        body: {
          name: "Bot",
          email: "bot@spam.com",
          instrument: "guitar",
          format: "online",
          website: "http://spam.com",
        },
      });
      expect(spam.status).toBe(400);
    }),
  );

  it.effect("auth: login, password flows", () =>
    Effect.gen(function* () {
      const loginRes = yield* reqEffect("POST", "/api/login", {
        body: { id: "student1", password: "student123" },
      });
      expect(loginRes.status).toBe(200);
      studentCookie = getCookie(loginRes)!;
      expect(studentCookie).toBeTruthy();

      const me = yield* reqEffect("GET", "/api/me", { cookie: studentCookie });
      expect(me.status).toBe(200);
      expect((yield* Effect.tryPromise(() => me.json())).user.username).toBe("student1");

      const logout = yield* reqEffect("POST", "/api/logout", { cookie: studentCookie });
      expect(logout.status).toBe(200);

      const login2 = yield* reqEffect("POST", "/api/login", {
        body: { id: "student1", password: "student123" },
      });
      studentCookie = getCookie(login2)!;

      const forgotRes = yield* reqEffect("POST", "/api/forgot-password", {
        body: { email: "student1@test.com" },
      });
      expect(forgotRes.status).toBe(200);

      const { rows } = yield* Effect.tryPromise(() =>
        testDb.query(
          "select reset_password_token from app_private.user_secrets where user_id = $1",
          [studentId],
        ),
      );
      expect(rows[0].reset_password_token).toBeTruthy();

      const resetRes = yield* reqEffect("POST", "/api/reset-password", {
        body: { token: rows[0].reset_password_token, password: "newpass123" },
      });
      expect(resetRes.status).toBe(200);
      studentCookie = getCookie(resetRes)!;
      expect(studentCookie).toBeTruthy();

      const me2 = yield* reqEffect("GET", "/api/me", { cookie: studentCookie });
      expect(me2.status).toBe(200);
      expect((yield* Effect.tryPromise(() => me2.json())).user.username).toBe("student1");
    }),
  );

  it.effect("auth: admin authorization follows live DB session and role state", () =>
    Effect.gen(function* () {
      const loginRes = yield* reqEffect("POST", "/api/login", {
        body: { id: "admin", password: "admin123" },
      });
      const freshAdminCookie = getCookie(loginRes);
      expect(freshAdminCookie).toBeTruthy();

      const cookieId = cookieIdFromToken(freshAdminCookie!);
      const sessionRows = yield* Effect.tryPromise(() =>
        testDb.query("select id, user_id from app_private.sessions where cookie_id = $1", [
          cookieId,
        ]),
      );
      expect(sessionRows.rows[0]?.id).toBeTruthy();
      expect(sessionRows.rows[0]?.user_id).toBeTruthy();

      yield* Effect.tryPromise(() =>
        testDb.query("delete from app_private.sessions where id = $1", [sessionRows.rows[0].id]),
      );

      const revoked = yield* reqEffect("GET", "/api/admin/courses", { cookie: freshAdminCookie! });
      expect(revoked.status).toBe(401);

      const deletedRows = yield* Effect.tryPromise(() =>
        testDb.query("select 1 from app_private.sessions where cookie_id = $1", [cookieId]),
      );
      expect(deletedRows.rowCount).toBe(0);

      const reloginRes = yield* reqEffect("POST", "/api/login", {
        body: { id: "admin", password: "admin123" },
      });
      const roleChangeCookie = getCookie(reloginRes);
      expect(roleChangeCookie).toBeTruthy();

      yield* Effect.tryPromise(() =>
        testDb.query("update app_public.users set role = 'student' where username = 'admin'"),
      );

      const forbidden = yield* reqEffect("GET", "/api/admin/courses", {
        cookie: roleChangeCookie!,
      });
      expect(forbidden.status).toBe(403);

      yield* Effect.tryPromise(() =>
        testDb.query("update app_public.users set role = 'admin' where username = 'admin'"),
      );
    }),
  );

  it.effect("auth: oauth start routes redirect and callbacks require valid state", () =>
    Effect.gen(function* () {
      const googleStart = yield* reqEffect("GET", "/api/oauth/google?redirect=%2Fsettings");
      expect(googleStart.status).toBe(302);
      expect(googleStart.headers.get("location")).toMatch(
        /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/,
      );
      const googleLocation = new URL(googleStart.headers.get("location")!);
      expect(googleLocation.searchParams.get("client_id")).toBe(process.env.GOOGLE_CLIENT_ID);
      expect(googleLocation.searchParams.get("access_type")).toBe("offline");
      expect(googleLocation.searchParams.get("redirect_uri")).toBe(
        `${TEST_ROOT_URL}/api/oauth/google/callback`,
      );
      expect(googleLocation.searchParams.get("code_challenge")).toBeTruthy();
      expect(googleLocation.searchParams.get("state")).toBeTruthy();
      const googleSetCookie = googleStart.headers.get("set-cookie");
      expect(googleSetCookie).toContain("oauth_google=");
      expect(googleSetCookie).toContain("oauth_google_redirect=");
      expect(googleSetCookie).toContain("SameSite=Lax");

      const googleCallback = yield* reqEffect(
        "GET",
        `/api/oauth/google/callback?code=fake-code&state=${googleLocation.searchParams.get("state")!}`,
      );
      expect(googleCallback.status).toBe(400);
      expect(yield* Effect.tryPromise(() => googleCallback.json())).toEqual({
        error: "Invalid or expired Google OAuth state",
      });

      const appleStart = yield* reqEffect("GET", "/api/oauth/apple?redirect=%2Fdashboard");
      expect(appleStart.status).toBe(302);
      expect(appleStart.headers.get("location")).toMatch(
        /^https:\/\/appleid\.apple\.com\/auth\/authorize\?/,
      );
      const appleLocation = new URL(appleStart.headers.get("location")!);
      expect(appleLocation.searchParams.get("client_id")).toBe(process.env.APPLE_CLIENT_ID);
      expect(appleLocation.searchParams.get("redirect_uri")).toBe(
        `${TEST_ROOT_URL}/api/oauth/apple/callback`,
      );
      expect(appleLocation.searchParams.get("response_mode")).toBe("form_post");
      expect(appleLocation.searchParams.get("state")).toBeTruthy();
      const appleSetCookie = appleStart.headers.get("set-cookie");
      expect(appleSetCookie).toContain("oauth_apple=");
      expect(appleSetCookie).toContain("oauth_apple_redirect=");
      expect(appleSetCookie).toContain("SameSite=None");

      const appleCallbackForm = new FormData();
      appleCallbackForm.append("code", "fake-code");
      appleCallbackForm.append("state", appleLocation.searchParams.get("state")!);
      const appleCallback = yield* reqEffect("POST", "/api/oauth/apple/callback", {
        body: appleCallbackForm,
      });
      expect(appleCallback.status).toBe(400);
      expect(yield* Effect.tryPromise(() => appleCallback.json())).toEqual({
        error: "Invalid or expired Apple OAuth state",
      });
    }),
  );

  it.effect("admin: gcal connect redirects and callback requires valid state", () =>
    Effect.gen(function* () {
      const connect = yield* reqEffect("GET", "/api/admin/gcal/connect", {
        cookie: adminCookie,
        csrf: false,
      });
      expect(connect.status).toBe(302);
      const location = connect.headers.get("location");
      expect(location).toBeTruthy();
      const authUrl = new URL(location!);
      expect(authUrl.origin).toBe("https://accounts.google.com");
      expect(authUrl.pathname).toBe("/o/oauth2/v2/auth");
      expect(authUrl.searchParams.get("client_id")).toBe(process.env.GOOGLE_CALENDAR_CLIENT_ID);
      expect(authUrl.searchParams.get("access_type")).toBe("offline");
      expect(authUrl.searchParams.get("redirect_uri")).toBe(
        `${TEST_ROOT_URL}/api/admin/gcal/callback`,
      );
      expect(authUrl.searchParams.get("code_challenge")).toBeTruthy();
      expect(authUrl.searchParams.get("state")).toBeTruthy();
      const setCookie = connect.headers.get("set-cookie");
      expect(setCookie).toContain("gcal_oauth=");
      expect(setCookie).toContain("SameSite=Lax");

      const callback = yield* reqEffect(
        "GET",
        `/api/admin/gcal/callback?code=fake-code&state=${authUrl.searchParams.get("state")!}`,
        { cookie: adminCookie, csrf: false },
      );
      expect(callback.status).toBe(400);
      expect(yield* Effect.tryPromise(() => callback.json())).toEqual({
        error: "Invalid or expired Google Calendar OAuth state",
      });
    }),
  );

  it.effect("testimonials: student CRUD, admin blocked", () =>
    Effect.gen(function* () {
      const create = yield* reqEffect("PUT", "/api/testimonials", {
        body: {
          body: "Daniel has made lessons fun, approachable, and easy to stick with every week.",
        },
        cookie: studentCookie,
      });
      expect(create.status).toBe(200);
      const created = yield* Effect.tryPromise(() => create.json());
      expect(created.body).toContain("lessons fun");
      expect(created.display_name).toBe("Test Student");
      expect(created.role_label).toBe("Student");
      expect(created.is_approved).toBe(false);

      const current = yield* reqEffect("GET", "/api/testimonials", { cookie: studentCookie });
      expect(current.status).toBe(200);
      const currentJson = yield* Effect.tryPromise(() => current.json());
      expect(currentJson.body).toContain("lessons fun");
      expect(currentJson.is_approved).toBe(false);

      const approve = yield* reqEffect("PATCH", `/api/admin/testimonials/${created.id}`, {
        body: { is_approved: true },
        cookie: adminCookie,
      });
      expect(approve.status).toBe(200);
      expect(yield* Effect.tryPromise(() => approve.json())).toEqual({ success: true });

      const { rows: approvedRows } = yield* Effect.tryPromise(() =>
        testDb.query(`select is_approved from app_public.testimonials where id = $1`, [created.id]),
      );
      expect(approvedRows[0].is_approved).toBe(true);

      const update = yield* reqEffect("PUT", "/api/testimonials", {
        body: {
          body: "Daniel has made lessons fun, practical, and something I actually look forward to each week.",
        },
        cookie: studentCookie,
      });
      expect(update.status).toBe(200);
      const updated = yield* Effect.tryPromise(() => update.json());
      expect(updated.body).toContain("look forward");
      expect(updated.is_approved).toBe(false);

      const adminAttempt = yield* reqEffect("GET", "/api/testimonials", { cookie: adminCookie });
      expect(adminAttempt.status).toBe(403);

      const remove = yield* reqEffect("DELETE", "/api/testimonials", { cookie: studentCookie });
      expect(remove.status).toBe(200);

      const afterDelete = yield* reqEffect("GET", "/api/testimonials", { cookie: studentCookie });
      expect(afterDelete.status).toBe(200);
      expect(yield* Effect.tryPromise(() => afterDelete.text())).toBe("");

      const { rows: reminderRows } = yield* Effect.tryPromise(() =>
        testDb.query(
          `select testimonial_prompt_enabled, testimonial_next_prompt_at from app_private.user_secrets where user_id = $1`,
          [studentId],
        ),
      );
      expect(reminderRows[0].testimonial_prompt_enabled).toBe(false);
      expect(reminderRows[0].testimonial_next_prompt_at).toBeTruthy();
    }),
  );

  it.effect("testimonials: admin interval updates schedule and worker enables prompts", () =>
    Effect.gen(function* () {
      const saveInterval = yield* reqEffect("POST", "/api/admin/testimonial-reminder-interval", {
        body: { interval_days: 14 },
        cookie: adminCookie,
      });
      expect(saveInterval.status).toBe(200);
      expect((yield* Effect.tryPromise(() => saveInterval.json())).interval_days).toBe(14);

      const { rows: scheduledRows } = yield* Effect.tryPromise(() =>
        testDb.query(
          `select testimonial_prompt_enabled, testimonial_next_prompt_at from app_private.user_secrets where user_id = $1`,
          [studentId],
        ),
      );
      expect(scheduledRows[0].testimonial_prompt_enabled).toBe(false);
      expect(new Date(scheduledRows[0].testimonial_next_prompt_at).getTime()).toBeGreaterThan(
        Date.now(),
      );

      yield* Effect.tryPromise(() =>
        testDb.query(
          `update app_private.user_secrets set testimonial_prompt_enabled = false, testimonial_next_prompt_at = now() - interval '1 minute', testimonial_last_emailed_at = null where user_id = $1`,
          [studentId],
        ),
      );

      const { default: reminderSweepTask } = yield* Effect.promise(
        () => import("../../worker/tasks/testimonials__reminder_sweep.js"),
      );
      const jobs: Array<{ identifier: string; payload: unknown }> = [];
      const workerLogger = new Logger(consoleLogFactory, { label: "test" });
      const poolClient = Object.assign(testDb, { release: () => undefined });
      const makeJob = (identifier: string, payload: unknown): Job => ({
        id: String(jobs.length + 1),
        job_queue_id: null,
        task_id: 1,
        payload,
        priority: 0,
        run_at: new Date(),
        attempts: 0,
        max_attempts: 1,
        last_error: null,
        created_at: new Date(),
        updated_at: new Date(),
        key: null,
        revision: 0,
        locked_at: null,
        locked_by: null,
        flags: null,
        is_available: true,
        task_identifier: identifier,
      });

      yield* Effect.promise(() =>
        Promise.resolve(
          reminderSweepTask(
            {},
            {
              job: makeJob("testimonials__reminder_sweep", {}),
              withPgClient: async (callback) => callback(poolClient),
              logger: workerLogger,
              getQueueName: async () => null,
              query: (queryText, values) => poolClient.query(queryText, values),
              addJob: async (identifier: string, payload: unknown) => {
                jobs.push({ identifier, payload });
                return makeJob(identifier, payload);
              },
            },
          ),
        ),
      );

      expect(jobs.some((job) => job.identifier === "send_email")).toBe(true);
      expect(jobs.some((job) => job.identifier === "testimonials__reminder_sweep")).toBe(false);

      const emailJob = jobs.find((job) => job.identifier === "send_email");
      expect(emailJob).toBeTruthy();
      expect(emailJob?.payload).toMatchObject({
        options: { to: "student1@test.com", subject: "How would you recommend DFG Music Lessons?" },
        template: "testimonial_reminder.mjml",
      });

      const { rows: afterSweepRows } = yield* Effect.tryPromise(() =>
        testDb.query(
          `select testimonial_prompt_enabled, testimonial_next_prompt_at, testimonial_last_emailed_at from app_private.user_secrets where user_id = $1`,
          [studentId],
        ),
      );
      expect(afterSweepRows[0].testimonial_prompt_enabled).toBe(true);
      expect(afterSweepRows[0].testimonial_last_emailed_at).toBeTruthy();
      expect(new Date(afterSweepRows[0].testimonial_next_prompt_at).getTime()).toBeGreaterThan(
        Date.now(),
      );
    }),
  );

  it.effect("materials: upload dedupes by hash and repairs missing blobs", () =>
    Effect.gen(function* () {
      const bytes = Buffer.from(`%PDF-1.4\n% dedupe test ${Date.now()}\n`);

      const uploadMaterial = (title: string, filename: string, isGlobal: boolean) => {
        const formData = new FormData();
        formData.append("file", new File([bytes], filename, { type: "application/pdf" }));
        formData.append("title", title);
        formData.append("is_global", isGlobal ? "true" : "false");
        return reqEffect("POST", "/api/admin/materials/upload", {
          body: formData,
          cookie: adminCookie,
        });
      };

      const firstUpload = yield* uploadMaterial("Original Title", "original-upload.pdf", true);
      expect(firstUpload.status).toBe(200);
      const firstMaterial = yield* Effect.tryPromise(() => firstUpload.json());
      expect(firstMaterial.title).toBe("Original Title");
      expect(firstMaterial.original_filename).toBe("original-upload.pdf");
      expect(firstMaterial.is_global).toBe(true);

      const firstRow = (yield* Effect.tryPromise(() =>
        testDb.query(
          `select id, content_hash, storage_backend, storage_key from app_public.materials where id = $1`,
          [firstMaterial.id],
        ),
      )).rows[0];
      expect(firstRow.content_hash).toBeTruthy();

      const { StorageService } = yield* Effect.promise(
        () => import("../services/storageService.js"),
      );
      yield* StorageService.delete({
        storageBackend: firstRow.storage_backend,
        storageKey: firstRow.storage_key,
      });

      const missingDownload = yield* reqEffect(
        "GET",
        `/api/materials/${firstMaterial.id}/download`,
        { cookie: adminCookie },
      );
      expect(missingDownload.status).toBe(500);
      expect(yield* Effect.tryPromise(() => missingDownload.json())).toEqual({
        error: "Material blob missing from storage",
      });

      const secondUpload = yield* uploadMaterial("Conflicting Title", "renamed-upload.pdf", false);
      expect(secondUpload.status).toBe(200);
      const secondMaterial = yield* Effect.tryPromise(() => secondUpload.json());
      expect(secondMaterial.id).toBe(firstMaterial.id);
      expect(secondMaterial.title).toBe("Original Title");
      expect(secondMaterial.original_filename).toBe("original-upload.pdf");
      expect(secondMaterial.is_global).toBe(true);

      const matchingRows = yield* Effect.tryPromise(() =>
        testDb.query(
          `select count(*)::int as count from app_public.materials where content_hash = $1`,
          [firstRow.content_hash],
        ),
      );
      expect(matchingRows.rows[0]?.count).toBe(1);
      expect(
        yield* StorageService.exists({
          storageBackend: firstRow.storage_backend,
          storageKey: firstRow.storage_key,
        }),
      ).toBe(true);
    }),
  );

  it.effect("messages: student can send a message to staff", () =>
    Effect.gen(function* () {
      const create = yield* reqEffect("POST", "/api/messages", {
        body: { body: "Can we move this week's lesson to Friday?" },
        cookie: studentCookie,
      });
      expect(create.status).toBe(200);
      const created = yield* Effect.tryPromise(() => create.json());
      expect(created.sender_id).toBe(studentId);
      expect(created.body).toBe("Can we move this week's lesson to Friday?");
      expect(created.recipient_id).toBeTruthy();

      const { rows } = yield* Effect.tryPromise(() =>
        testDb.query(
          `select m.sender_id, m.body, u.role as recipient_role from app_public.messages m join app_public.users u on u.id = m.recipient_id where m.id = $1`,
          [created.id],
        ),
      );
      expect(rows[0]?.sender_id).toBe(studentId);
      expect(rows[0]?.body).toBe("Can we move this week's lesson to Friday?");
      expect(["admin", "teacher"]).toContain(rows[0]?.recipient_role);
    }),
  );

  it.effect("assignments: tracks playback time and self-reviews", () =>
    Effect.gen(function* () {
      const notationTracks = [
        { index: 0, name: "Lead Guitar", short_name: "Lead", is_percussion: false },
        { index: 1, name: "Bass", short_name: "Bass", is_percussion: false },
      ];
      const notationMat = (yield* Effect.tryPromise(() =>
        testDb.query(
          `insert into app_public.materials (title, original_filename, storage_key, mime_type, file_size, is_global, notation_tracks) values ($1, $2, $3, $4, $5, $6, $7::jsonb) returning id`,
          [
            "Etude in G",
            "etude.gp5",
            "/data/etude.gp5",
            "application/octet-stream",
            4096,
            false,
            JSON.stringify(notationTracks),
          ],
        ),
      )).rows[0];

      const missingTrack = yield* reqEffect("POST", `/api/admin/students/${studentId}/assign`, {
        body: { material_id: notationMat.id },
        cookie: adminCookie,
      });
      expect(missingTrack.status).toBe(400);

      const assign = yield* reqEffect("POST", `/api/admin/students/${studentId}/assign`, {
        body: { material_id: notationMat.id, assigned_track_index: 1 },
        cookie: adminCookie,
      });
      expect(assign.status).toBe(200);

      const assignmentRow = yield* Effect.tryPromise(() =>
        testDb.query(
          `select assigned_track_index from app_public.student_materials where student_id = $1 and material_id = $2`,
          [studentId, notationMat.id],
        ),
      );
      expect(assignmentRow.rows[0]?.assigned_track_index).toBe(1);

      const playback1 = yield* reqEffect("POST", `/api/assignments/${notationMat.id}/playback`, {
        body: { seconds: 35 },
        cookie: studentCookie,
      });
      expect(playback1.status).toBe(200);
      expect((yield* Effect.tryPromise(() => playback1.json())).listened_seconds).toBe(35);

      const review1 = yield* reqEffect("POST", `/api/assignments/${notationMat.id}/reviews`, {
        body: { stars: 4 },
        cookie: studentCookie,
      });
      expect(review1.status).toBe(200);
      const review1Body = yield* Effect.tryPromise(() => review1.json());
      expect(review1Body.stars).toBe(4);
      expect(review1Body.listened_seconds).toBe(35);

      const playback2 = yield* reqEffect("POST", `/api/assignments/${notationMat.id}/playback`, {
        body: { seconds: 25 },
        cookie: studentCookie,
      });
      expect(playback2.status).toBe(200);
      expect((yield* Effect.tryPromise(() => playback2.json())).listened_seconds).toBe(60);

      const review2 = yield* reqEffect("POST", `/api/assignments/${notationMat.id}/reviews`, {
        body: { stars: 5 },
        cookie: studentCookie,
      });
      expect(review2.status).toBe(200);
      const review2Body = yield* Effect.tryPromise(() => review2.json());
      expect(review2Body.stars).toBe(5);
      expect(review2Body.listened_seconds).toBe(60);

      const adminAttempt = yield* reqEffect("POST", `/api/assignments/${notationMat.id}/playback`, {
        body: { seconds: 10 },
        cookie: adminCookie,
      });
      expect(adminAttempt.status).toBe(403);

      expect(
        (yield* reqEffect("DELETE", `/api/admin/students/${studentId}/assign/${notationMat.id}`, {
          cookie: adminCookie,
        })).status,
      ).toBe(200);
      expect(
        (yield* reqEffect("DELETE", `/api/admin/materials/${notationMat.id}`, {
          cookie: adminCookie,
        })).status,
      ).toBe(200);
    }),
  );

  it.effect("curriculum: admin CRUD, enrollment, student views", () =>
    Effect.gen(function* () {
      const createCourse = yield* reqEffect("POST", "/api/admin/courses", {
        body: { title: "Guitar 101", instrument: "guitar", description: "Beginner guitar" },
        cookie: adminCookie,
      });
      expect(createCourse.status).toBe(200);
      const course = yield* Effect.tryPromise(() => createCourse.json());
      const courseId = course.id;
      expect(course.title).toBe("Guitar 101");

      const updateCourse = yield* reqEffect("PATCH", `/api/admin/courses/${courseId}`, {
        body: { description: "Updated beginner guitar" },
        cookie: adminCookie,
      });
      expect(updateCourse.status).toBe(200);
      expect((yield* Effect.tryPromise(() => updateCourse.json())).description).toBe(
        "Updated beginner guitar",
      );

      const createMod = yield* reqEffect("POST", `/api/admin/courses/${courseId}/modules`, {
        body: { title: "Week 1: Basics", sort_order: 1 },
        cookie: adminCookie,
      });
      expect(createMod.status).toBe(200);
      const mod = yield* Effect.tryPromise(() => createMod.json());
      const moduleId = mod.id;

      const updateMod = yield* reqEffect("PATCH", `/api/admin/modules/${moduleId}`, {
        body: { title: "Week 1: Fundamentals" },
        cookie: adminCookie,
      });
      expect(updateMod.status).toBe(200);
      expect((yield* Effect.tryPromise(() => updateMod.json())).title).toBe("Week 1: Fundamentals");

      const globalMat = (yield* Effect.tryPromise(() =>
        testDb.query(
          `insert into app_public.materials (title, original_filename, storage_key, mime_type, file_size, is_global) values ($1, $2, $3, $4, $5, $6) returning id`,
          ["Chord Chart", "chords.pdf", "/data/chords.pdf", "application/pdf", 12345, true],
        ),
      )).rows[0];

      const privateMat = (yield* Effect.tryPromise(() =>
        testDb.query(
          `insert into app_public.materials (title, original_filename, storage_key, mime_type, file_size, is_global) values ($1, $2, $3, $4, $5, $6) returning id`,
          ["Private Notes", "notes.pdf", "/data/notes.pdf", "application/pdf", 5432, false],
        ),
      )).rows[0];

      const attach = yield* reqEffect("PATCH", `/api/admin/modules/${moduleId}`, {
        body: {
          content: {
            type: "doc",
            content: [{ type: "materialEmbed", attrs: { materialId: globalMat.id } }],
          },
        },
        cookie: adminCookie,
      });
      expect(attach.status).toBe(200);

      const enroll = yield* reqEffect("POST", `/api/admin/students/${studentId}/enroll`, {
        body: { course_id: courseId },
        cookie: adminCookie,
      });
      expect(enroll.status).toBe(200);

      const assign = yield* reqEffect("POST", `/api/admin/students/${studentId}/assign`, {
        body: { material_id: privateMat.id },
        cookie: adminCookie,
      });
      expect(assign.status).toBe(200);

      const adminCourses = yield* reqEffect("GET", "/api/admin/courses", { cookie: adminCookie });
      expect(adminCourses.status).toBe(200);
      expect((yield* Effect.tryPromise(() => adminCourses.json())).length).toBeGreaterThanOrEqual(
        1,
      );

      const courses = yield* reqEffect("GET", "/api/courses", { cookie: studentCookie });
      expect(courses.status).toBe(200);
      const courseList = yield* Effect.tryPromise(() => courses.json());
      expect(courseList).toHaveLength(1);
      expect(courseList[0].title).toBe("Guitar 101");

      const detail = yield* reqEffect("GET", `/api/courses/${courseId}`, { cookie: studentCookie });
      expect(detail.status).toBe(200);
      const courseDetail = yield* Effect.tryPromise(() => detail.json());
      expect(courseDetail.modules).toHaveLength(1);
      expect(courseDetail.modules[0].materials).toHaveLength(1);
      expect(courseDetail.modules[0].materials[0].title).toBe("Chord Chart");

      const library = yield* reqEffect("GET", "/api/library", { cookie: studentCookie });
      expect(library.status).toBe(200);
      const libraryList = (yield* Effect.tryPromise(() => library.json())) as TitledItem[];
      expect(libraryList.some((material) => material.title === "Chord Chart")).toBe(true);

      const assignments = yield* reqEffect("GET", "/api/assignments", { cookie: studentCookie });
      expect(assignments.status).toBe(200);
      const assignList = (yield* Effect.tryPromise(() => assignments.json())) as TitledItem[];
      expect(assignList.some((material) => material.title === "Private Notes")).toBe(true);

      expect(
        (yield* reqEffect("DELETE", `/api/admin/students/${studentId}/assign/${privateMat.id}`, {
          cookie: adminCookie,
        })).status,
      ).toBe(200);
      expect(
        (yield* reqEffect("DELETE", `/api/admin/students/${studentId}/enroll/${courseId}`, {
          cookie: adminCookie,
        })).status,
      ).toBe(200);

      const empty = yield* reqEffect("GET", "/api/courses", { cookie: studentCookie });
      expect(empty.status).toBe(200);
      expect(yield* Effect.tryPromise(() => empty.json())).toHaveLength(0);

      expect(
        (yield* reqEffect("DELETE", `/api/admin/modules/${moduleId}`, { cookie: adminCookie }))
          .status,
      ).toBe(200);
      expect(
        (yield* reqEffect("DELETE", `/api/admin/courses/${courseId}`, { cookie: adminCookie }))
          .status,
      ).toBe(200);
    }),
  );

  it.effect("admin: submissions and student list", () =>
    Effect.gen(function* () {
      const subs = yield* reqEffect("GET", "/api/admin/submissions", { cookie: adminCookie });
      expect(subs.status).toBe(200);
      const subList = (yield* Effect.tryPromise(() => subs.json())) as SubmissionSummary[];
      expect(subList.length).toBeGreaterThanOrEqual(1);
      const sub = subList.find((submission) => submission.email === "jane@example.com");
      expect(sub).toBeTruthy();
      if (!sub) throw new Error("Expected seeded submission to exist");
      expect(sub.is_read).toBe(false);

      const patch = yield* reqEffect("PATCH", `/api/admin/submissions/${sub.id}`, {
        body: { is_read: true },
        cookie: adminCookie,
      });
      expect(patch.status).toBe(200);

      const students = yield* reqEffect("GET", "/api/admin/students", { cookie: adminCookie });
      expect(students.status).toBe(200);
      const studentList = (yield* Effect.tryPromise(() => students.json())) as StudentSummary[];
      expect(studentList.some((student) => student.username === "student1")).toBe(true);
    }),
  );

  it.effect("authorization: access control", () =>
    Effect.gen(function* () {
      const unauth = yield* reqEffect("GET", "/api/courses");
      expect(unauth.status).toBe(401);

      const studentAdmin = yield* reqEffect("GET", "/api/admin/courses", { cookie: studentCookie });
      expect(studentAdmin.status).toBe(403);

      const meNoAuth = yield* reqEffect("GET", "/api/me");
      expect(meNoAuth.status).toBe(200);
      expect((yield* Effect.tryPromise(() => meNoAuth.json())).user).toBeNull();
    }),
  );
});
