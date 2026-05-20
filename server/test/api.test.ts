import { describe, beforeAll, afterAll, expect, it } from "vitest";
import pg from "pg";
import { execSync } from "child_process";
import { mkdirSync, readFileSync } from "fs";
import Redis from "ioredis";
import { Logger, consoleLogFactory, type Job } from "graphile-worker";

// -- Shared state --
let handler: (request: Request) => Promise<Response>;
let testDb: pg.Client;
let testValkey: Redis | null = null;

let adminCookie: string;
let studentCookie: string;
let studentId: string;
const testApplePrivateKey = "-----BEGIN PRIVATE KEY-----\\nAQAB\\n-----END PRIVATE KEY-----";

function loadDotEnvFile() {
  const envPath = `${process.cwd()}/.env`;
  const contents = readFileSync(envPath, "utf8");

  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = trimmed.slice(separatorIndex + 1);
  }
}

loadDotEnvFile();

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }

  return value;
}

function withDatabaseSuffix(connectionString: string, suffix: string): string {
  const url = new URL(connectionString);
  const databaseName = url.pathname.replace(/^\/+/, "");

  if (!databaseName) {
    throw new Error(`Connection string is missing a database name: ${connectionString}`);
  }

  url.pathname = `/${databaseName}${suffix}`;
  return url.toString();
}

function withRedisDatabase(connectionString: string, databaseIndex: number): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseIndex}`;
  return url.toString();
}

// -- Helpers --
const TEST_ROOT_URL = "http://localhost:3000";

function req(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; csrf?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.csrf !== false) {
    headers["X-Requested-With"] = "dfg";
  }
  if (opts.cookie) headers["Cookie"] = `session=${opts.cookie}`;

  const body =
    opts.body instanceof FormData
      ? opts.body
      : opts.body !== undefined
        ? (() => {
            headers["Content-Type"] = "application/json";
            return JSON.stringify(opts.body);
          })()
        : undefined;

  return handler(
    new Request(`${TEST_ROOT_URL}${path}`, {
      method,
      headers,
      body,
    }),
  );
}

function getCookie(res: Response): string | null {
  const header = res.headers.get("set-cookie");
  if (!header) return null;
  const match = header.match(/session=([^;]+)/);
  return match?.[1] ?? null;
}

// -- Setup / Teardown --
describe("DFG Portal API", () => {
  beforeAll(async () => {
    const dbUrl = withDatabaseSuffix(requiredEnv("DATABASE_URL"), "_test");
    const authDbUrl = withDatabaseSuffix(requiredEnv("AUTH_DATABASE_URL"), "_test");
    const testValkeyUrl = withRedisDatabase(requiredEnv("VALKEY_URL"), 15);
    const childEnv: Record<string, string> = {
      ...process.env,
      DATABASE_URL: dbUrl,
      AUTH_DATABASE_URL: authDbUrl,
      VALKEY_URL: testValkeyUrl,
      NOCONFIRM: "1",
      NODE_ENV: "test",
      PORT: "0",
      VITE_ROOT_URL: process.env.VITE_ROOT_URL || "http://localhost:3000",
      ADMIN_EMAIL: process.env.ADMIN_EMAIL || "admin@test.com",
      GOOGLE_CALENDAR_CLIENT_ID:
        process.env.GOOGLE_CALENDAR_CLIENT_ID || "gcal-client-id",
      GOOGLE_CALENDAR_CLIENT_SECRET:
        process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "gcal-client-secret",
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "google-client-id",
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "google-client-secret",
      APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID || "apple-client-id",
      APPLE_TEAM_ID: process.env.APPLE_TEAM_ID || "apple-team-id",
      APPLE_KEY_ID: process.env.APPLE_KEY_ID || "apple-key-id",
      APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY || testApplePrivateKey,
    };

    mkdirSync("generated", { recursive: true });
    execSync("bun -b graphile-migrate reset --erase", {
      env: childEnv,
      stdio: "pipe",
      cwd: process.cwd(),
    });
    execSync("cd worker && bun -b graphile-worker --schema-only", {
      env: childEnv,
      stdio: "pipe",
      cwd: process.cwd(),
    });
    execSync("bun -b graphile-migrate watch --once", {
      env: childEnv,
      stdio: "pipe",
      cwd: process.cwd(),
    });

    Object.assign(process.env, childEnv);

    testValkey = new Redis(testValkeyUrl);
    await testValkey.flushdb();

    testDb = new pg.Client({ connectionString: dbUrl });
    await testDb.connect();
    const adminResult = await testDb.query(
      `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
      ["admin", "Test Admin", "admin@test.com", "admin123"],
    );
    await testDb.query(`update app_public.users set role = 'admin' where id = $1`, [
      adminResult.rows[0].id,
    ]);

    const { app } = await import("../app.js");
    handler = (request: Request) => Promise.resolve(app.fetch(request));

    const loginRes = await req("POST", "/api/login", {
      body: { id: "admin", password: "admin123" },
    });
    adminCookie = getCookie(loginRes)!;
    if (!adminCookie) {
      const body = await loginRes.text();
      throw new Error(`Admin login failed (${loginRes.status}): ${body}`);
    }

    const studentResult = await testDb.query(
      `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
      ["student1", "Test Student", "student1@test.com", "student123"],
    );
    studentId = studentResult.rows[0].id;

    const studentLoginRes = await req("POST", "/api/login", {
      body: { id: "student1", password: "student123" },
    });
    studentCookie = getCookie(studentLoginRes)!;
    if (!studentCookie) {
      const body = await studentLoginRes.text();
      throw new Error(`Student login failed (${studentLoginRes.status}): ${body}`);
    }
  }, 120_000);

  afterAll(async () => {
    try {
      const { realtimeService } = await import("../services/realtimeService.js");
      await realtimeService.stop();
    } catch {}
    try {
      const db = await import("../db.js");
      await db.rootDb.destroy();
      await db.authDb.destroy();
    } catch {}
    try {
      const { valkey } = await import("../valkey.js");
      valkey.disconnect();
    } catch {}
    await testValkey?.quit();
    await testDb?.end();
  }, 30_000);

  // -- Test 1: Public endpoints --
  it("public: health check and contact form", async () => {
    const health = await req("GET", "/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ success: true });

    const contact = await req("POST", "/api/contact", {
      body: {
        name: "Jane Doe",
        email: "jane@example.com",
        instrument: "piano",
        format: "in-person",
        message: "Looking for lessons",
      },
    });
    expect(contact.status).toBe(200);
    expect(await contact.json()).toEqual({ success: true });

    const spam = await req("POST", "/api/contact", {
      body: {
        name: "Bot",
        email: "bot@spam.com",
        instrument: "guitar",
        format: "online",
        website: "http://spam.com",
      },
    });
    expect(spam.status).toBe(400);
  });

  // -- Test 2: Auth lifecycle --
  it("auth: login, password flows", async () => {
    // Login with password
    const loginRes = await req("POST", "/api/login", {
      body: { id: "student1", password: "student123" },
    });
    expect(loginRes.status).toBe(200);
    studentCookie = getCookie(loginRes)!;
    expect(studentCookie).toBeTruthy();

    // GET /me
    const me = await req("GET", "/api/me", { cookie: studentCookie });
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expect(meBody.user.username).toBe("student1");

    // Logout
    const logout = await req("POST", "/api/logout", { cookie: studentCookie });
    expect(logout.status).toBe(200);

    // Re-login
    const login2 = await req("POST", "/api/login", {
      body: { id: "student1", password: "student123" },
    });
    studentCookie = getCookie(login2)!;

    // Forgot password
    const forgotRes = await req("POST", "/api/forgot-password", {
      body: { email: "student1@test.com" },
    });
    expect(forgotRes.status).toBe(200);

    // Read reset token from DB
    const { rows } = await testDb.query(
      "select reset_password_token from app_private.user_secrets where user_id = $1",
      [studentId],
    );
    expect(rows[0].reset_password_token).toBeTruthy();

    // Reset password
    const resetRes = await req("POST", "/api/reset-password", {
      body: { token: rows[0].reset_password_token, password: "newpass123" },
    });
    expect(resetRes.status).toBe(200);
    studentCookie = getCookie(resetRes)!;
    expect(studentCookie).toBeTruthy();

    // Verify new session
    const me2 = await req("GET", "/api/me", { cookie: studentCookie });
    expect(me2.status).toBe(200);
    expect((await me2.json()).user.username).toBe("student1");
  });

  it("auth: oauth start routes redirect and callbacks require valid state", async () => {
    const googleStart = await req("GET", "/api/oauth/google?redirect=%2Fsettings");
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

    const googleCallback = await req(
      "GET",
      `/api/oauth/google/callback?code=fake-code&state=${googleLocation.searchParams.get("state")!}`,
    );
    expect(googleCallback.status).toBe(400);
    expect(await googleCallback.json()).toEqual({ error: "Invalid or expired Google OAuth state" });

    const appleStart = await req("GET", "/api/oauth/apple?redirect=%2Fdashboard");
    expect(appleStart.status).toBe(302);
    expect(appleStart.headers.get("location")).toMatch(/^https:\/\/appleid\.apple\.com\/auth\/authorize\?/);
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

    const appleCallback = await req("POST", "/api/oauth/apple/callback", {
      body: { code: "fake-code", state: appleLocation.searchParams.get("state") },
    });
    expect(appleCallback.status).toBe(400);
    expect(await appleCallback.json()).toEqual({ error: "Invalid or expired Apple OAuth state" });
  });

  it("admin: gcal connect redirects and callback requires valid state", async () => {
    const connect = await req("GET", "/api/admin/gcal/connect", {
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

    const callback = await req(
      "GET",
      `/api/admin/gcal/callback?code=fake-code&state=${authUrl.searchParams.get("state")!}`,
      {
        cookie: adminCookie,
        csrf: false,
      },
    );
    expect(callback.status).toBe(400);
    expect(await callback.json()).toEqual({
      error: "Invalid or expired Google Calendar OAuth state",
    });
  });

  // -- Test 3: Testimonials --
  it("testimonials: student CRUD, admin blocked", async () => {
    const create = await req("PUT", "/api/testimonials", {
      body: {
        body: "Daniel has made lessons fun, approachable, and easy to stick with every week.",
      },
      cookie: studentCookie,
    });
    expect(create.status).toBe(200);
    const created = await create.json();
    expect(created.body).toContain("lessons fun");
    expect(created.display_name).toBe("Test Student");
    expect(created.role_label).toBe("Student");

    const current = await req("GET", "/api/testimonials", {
      cookie: studentCookie,
    });
    expect(current.status).toBe(200);
    expect((await current.json()).body).toContain("lessons fun");

    const update = await req("PUT", "/api/testimonials", {
      body: {
        body: "Daniel has made lessons fun, practical, and something I actually look forward to each week.",
      },
      cookie: studentCookie,
    });
    expect(update.status).toBe(200);
    expect((await update.json()).body).toContain("look forward");

    const adminAttempt = await req("GET", "/api/testimonials", {
      cookie: adminCookie,
    });
    expect(adminAttempt.status).toBe(403);

    const remove = await req("DELETE", "/api/testimonials", {
      cookie: studentCookie,
    });
    expect(remove.status).toBe(200);

    const afterDelete = await req("GET", "/api/testimonials", {
      cookie: studentCookie,
    });
    expect(afterDelete.status).toBe(200);
    expect(await afterDelete.text()).toBe("");

    const { rows: reminderRows } = await testDb.query(
      `select testimonial_prompt_enabled, testimonial_next_prompt_at
       from app_private.user_secrets
       where user_id = $1`,
      [studentId],
    );
    expect(reminderRows[0].testimonial_prompt_enabled).toBe(false);
    expect(reminderRows[0].testimonial_next_prompt_at).toBeTruthy();
  });

  it("testimonials: admin interval updates schedule and worker enables prompts", async () => {
    const saveInterval = await req("POST", "/api/admin/testimonial-reminder-interval", {
      body: { interval_days: 14 },
      cookie: adminCookie,
    });
    expect(saveInterval.status).toBe(200);
    expect((await saveInterval.json()).interval_days).toBe(14);

    const { rows: scheduledRows } = await testDb.query(
      `select testimonial_prompt_enabled, testimonial_next_prompt_at
       from app_private.user_secrets
       where user_id = $1`,
      [studentId],
    );
    expect(scheduledRows[0].testimonial_prompt_enabled).toBe(false);
    expect(new Date(scheduledRows[0].testimonial_next_prompt_at).getTime()).toBeGreaterThan(
      Date.now(),
    );

    await testDb.query(
      `update app_private.user_secrets
       set testimonial_prompt_enabled = false,
           testimonial_next_prompt_at = now() - interval '1 minute',
           testimonial_last_emailed_at = null
       where user_id = $1`,
      [studentId],
    );

    const { default: reminderSweepTask } =
      await import("../../worker/tasks/testimonials__reminder_sweep.js");
    const jobs: Array<{ identifier: string; payload: unknown }> = [];
    const workerLogger = new Logger(consoleLogFactory, { label: "test" });
    const poolClient = Object.assign(testDb, {
      release: () => undefined,
    });
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

    await reminderSweepTask(
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
    );

    expect(jobs.some((job) => job.identifier === "send_email")).toBe(true);
    expect(jobs.some((job) => job.identifier === "testimonials__reminder_sweep")).toBe(false);

    const emailJob = jobs.find((job) => job.identifier === "send_email");
    expect(emailJob).toBeTruthy();
    expect(emailJob?.payload).toMatchObject({
      options: {
        to: "student1@test.com",
        subject: "How would you recommend DFG Music Lessons?",
      },
      template: "testimonial_reminder.mjml",
    });

    const { rows: afterSweepRows } = await testDb.query(
      `select
         testimonial_prompt_enabled,
         testimonial_next_prompt_at,
         testimonial_last_emailed_at
       from app_private.user_secrets
       where user_id = $1`,
      [studentId],
    );
    expect(afterSweepRows[0].testimonial_prompt_enabled).toBe(true);
    expect(afterSweepRows[0].testimonial_last_emailed_at).toBeTruthy();
    expect(new Date(afterSweepRows[0].testimonial_next_prompt_at).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("materials: upload dedupes by hash and repairs missing blobs", async () => {
    const bytes = Buffer.from(`%PDF-1.4\n% dedupe test ${Date.now()}\n`);

    const uploadMaterial = (title: string, filename: string, isGlobal: boolean) => {
      const formData = new FormData();
      formData.append("file", new File([bytes], filename, { type: "application/pdf" }));
      formData.append("title", title);
      formData.append("is_global", isGlobal ? "true" : "false");
      return req("POST", "/api/admin/materials/upload", {
        body: formData,
        cookie: adminCookie,
      });
    };

    const firstUpload = await uploadMaterial("Original Title", "original-upload.pdf", true);
    expect(firstUpload.status).toBe(200);
    const firstMaterial = await firstUpload.json();
    expect(firstMaterial.title).toBe("Original Title");
    expect(firstMaterial.original_filename).toBe("original-upload.pdf");
    expect(firstMaterial.is_global).toBe(true);

    const firstRow = (
      await testDb.query(
        `select id, content_hash, storage_backend, storage_key
         from app_public.materials
         where id = $1`,
        [firstMaterial.id],
      )
    ).rows[0];
    expect(firstRow.content_hash).toBeTruthy();

    const { storageService } = await import("../services/storageService.js");
    await storageService.delete({
      storageBackend: firstRow.storage_backend,
      storageKey: firstRow.storage_key,
    });

    const missingDownload = await req("GET", `/api/materials/${firstMaterial.id}/download`, {
      cookie: adminCookie,
    });
    expect(missingDownload.status).toBe(500);
    expect(await missingDownload.json()).toEqual({ error: "Material blob missing from storage" });

    const secondUpload = await uploadMaterial("Conflicting Title", "renamed-upload.pdf", false);
    expect(secondUpload.status).toBe(200);
    const secondMaterial = await secondUpload.json();
    expect(secondMaterial.id).toBe(firstMaterial.id);
    expect(secondMaterial.title).toBe("Original Title");
    expect(secondMaterial.original_filename).toBe("original-upload.pdf");
    expect(secondMaterial.is_global).toBe(true);

    const matchingRows = await testDb.query(
      `select count(*)::int as count
       from app_public.materials
       where content_hash = $1`,
      [firstRow.content_hash],
    );
    expect(matchingRows.rows[0]?.count).toBe(1);
    expect(
      await storageService.exists({
        storageBackend: firstRow.storage_backend,
        storageKey: firstRow.storage_key,
      }),
    ).toBe(true);
  });

  it("assignments: tracks playback time and self-reviews", async () => {
    const notationTracks = [
      {
        index: 0,
        name: "Lead Guitar",
        short_name: "Lead",
        is_percussion: false,
      },
      {
        index: 1,
        name: "Bass",
        short_name: "Bass",
        is_percussion: false,
      },
    ];
    const notationMat = (
      await testDb.query(
        `insert into app_public.materials (
           title,
           original_filename,
           storage_key,
           mime_type,
           file_size,
           is_global,
           notation_tracks
         )
         values ($1, $2, $3, $4, $5, $6, $7::jsonb)
         returning id`,
        [
          "Etude in G",
          "etude.gp5",
          "/data/etude.gp5",
          "application/octet-stream",
          4096,
          false,
          JSON.stringify(notationTracks),
        ],
      )
    ).rows[0];

    const missingTrack = await req("POST", `/api/admin/students/${studentId}/assign`, {
      body: { material_id: notationMat.id },
      cookie: adminCookie,
    });
    expect(missingTrack.status).toBe(400);

    const assign = await req("POST", `/api/admin/students/${studentId}/assign`, {
      body: { material_id: notationMat.id, assigned_track_index: 1 },
      cookie: adminCookie,
    });
    expect(assign.status).toBe(200);

    const assignmentRow = await testDb.query(
      `select assigned_track_index
       from app_public.student_materials
       where student_id = $1 and material_id = $2`,
      [studentId, notationMat.id],
    );
    expect(assignmentRow.rows[0]?.assigned_track_index).toBe(1);

    const playback1 = await req("POST", `/api/assignments/${notationMat.id}/playback`, {
      body: { seconds: 35 },
      cookie: studentCookie,
    });
    expect(playback1.status).toBe(200);
    expect((await playback1.json()).listened_seconds).toBe(35);

    const review1 = await req("POST", `/api/assignments/${notationMat.id}/reviews`, {
      body: { stars: 4 },
      cookie: studentCookie,
    });
    expect(review1.status).toBe(200);
    const review1Body = await review1.json();
    expect(review1Body.stars).toBe(4);
    expect(review1Body.listened_seconds).toBe(35);

    const playback2 = await req("POST", `/api/assignments/${notationMat.id}/playback`, {
      body: { seconds: 25 },
      cookie: studentCookie,
    });
    expect(playback2.status).toBe(200);
    expect((await playback2.json()).listened_seconds).toBe(60);

    const review2 = await req("POST", `/api/assignments/${notationMat.id}/reviews`, {
      body: { stars: 5 },
      cookie: studentCookie,
    });
    expect(review2.status).toBe(200);
    const review2Body = await review2.json();
    expect(review2Body.stars).toBe(5);
    expect(review2Body.listened_seconds).toBe(60);

    const adminAttempt = await req("POST", `/api/assignments/${notationMat.id}/playback`, {
      body: { seconds: 10 },
      cookie: adminCookie,
    });
    expect(adminAttempt.status).toBe(403);

    expect(
      (
        await req("DELETE", `/api/admin/students/${studentId}/assign/${notationMat.id}`, {
          cookie: adminCookie,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await req("DELETE", `/api/admin/materials/${notationMat.id}`, {
          cookie: adminCookie,
        })
      ).status,
    ).toBe(200);
  });

  // -- Test 4: Curriculum CRUD + student access --
  it("curriculum: admin CRUD, enrollment, student views", async () => {
    // Create course
    const createCourse = await req("POST", "/api/admin/courses", {
      body: {
        title: "Guitar 101",
        instrument: "guitar",
        description: "Beginner guitar",
      },
      cookie: adminCookie,
    });
    expect(createCourse.status).toBe(200);
    const course = await createCourse.json();
    const courseId = course.id;
    expect(course.title).toBe("Guitar 101");

    // Update course
    const updateCourse = await req("PATCH", `/api/admin/courses/${courseId}`, {
      body: { description: "Updated beginner guitar" },
      cookie: adminCookie,
    });
    expect(updateCourse.status).toBe(200);
    expect((await updateCourse.json()).description).toBe("Updated beginner guitar");

    // Create module
    const createMod = await req("POST", `/api/admin/courses/${courseId}/modules`, {
      body: { title: "Week 1: Basics", sort_order: 1 },
      cookie: adminCookie,
    });
    expect(createMod.status).toBe(200);
    const mod = await createMod.json();
    const moduleId = mod.id;

    // Update module
    const updateMod = await req("PATCH", `/api/admin/modules/${moduleId}`, {
      body: { title: "Week 1: Fundamentals" },
      cookie: adminCookie,
    });
    expect(updateMod.status).toBe(200);
    expect((await updateMod.json()).title).toBe("Week 1: Fundamentals");

    // Seed materials via DB
    const globalMat = (
      await testDb.query(
        `insert into app_public.materials (title, original_filename, storage_key, mime_type, file_size, is_global)
        values ($1, $2, $3, $4, $5, $6) returning id`,
        ["Chord Chart", "chords.pdf", "/data/chords.pdf", "application/pdf", 12345, true],
      )
    ).rows[0];

    const privateMat = (
      await testDb.query(
        `insert into app_public.materials (title, original_filename, storage_key, mime_type, file_size, is_global)
        values ($1, $2, $3, $4, $5, $6) returning id`,
        ["Private Notes", "notes.pdf", "/data/notes.pdf", "application/pdf", 5432, false],
      )
    ).rows[0];

    // Sync module materials via content
    const attach = await req("PATCH", `/api/admin/modules/${moduleId}`, {
      body: {
        content: {
          type: "doc",
          content: [{ type: "materialEmbed", attrs: { materialId: globalMat.id } }],
        },
      },
      cookie: adminCookie,
    });
    expect(attach.status).toBe(200);

    // Enroll student
    const enroll = await req("POST", `/api/admin/students/${studentId}/enroll`, {
      body: { course_id: courseId },
      cookie: adminCookie,
    });
    expect(enroll.status).toBe(200);

    // Assign private material
    const assign = await req("POST", `/api/admin/students/${studentId}/assign`, {
      body: { material_id: privateMat.id },
      cookie: adminCookie,
    });
    expect(assign.status).toBe(200);

    // Admin lists courses
    const adminCourses = await req("GET", "/api/admin/courses", {
      cookie: adminCookie,
    });
    expect(adminCourses.status).toBe(200);
    expect((await adminCourses.json()).length).toBeGreaterThanOrEqual(1);

    // Student courses (enrolled)
    const courses = await req("GET", "/api/courses", { cookie: studentCookie });
    expect(courses.status).toBe(200);
    const courseList = await courses.json();
    expect(courseList).toHaveLength(1);
    expect(courseList[0].title).toBe("Guitar 101");

    // Course detail with modules + materials
    const detail = await req("GET", `/api/courses/${courseId}`, {
      cookie: studentCookie,
    });
    expect(detail.status).toBe(200);
    const courseDetail = await detail.json();
    expect(courseDetail.modules).toHaveLength(1);
    expect(courseDetail.modules[0].materials).toHaveLength(1);
    expect(courseDetail.modules[0].materials[0].title).toBe("Chord Chart");

    // Library (global materials)
    const library = await req("GET", "/api/library", { cookie: studentCookie });
    expect(library.status).toBe(200);
    const libraryList = await library.json();
    expect(libraryList.some((m: any) => m.title === "Chord Chart")).toBe(true);

    // Assignments
    const assignments = await req("GET", "/api/assignments", {
      cookie: studentCookie,
    });
    expect(assignments.status).toBe(200);
    const assignList = await assignments.json();
    expect(assignList.some((m: any) => m.title === "Private Notes")).toBe(true);

    // Cleanup
    expect(
      (
        await req("DELETE", `/api/admin/students/${studentId}/assign/${privateMat.id}`, {
          cookie: adminCookie,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await req("DELETE", `/api/admin/students/${studentId}/enroll/${courseId}`, {
          cookie: adminCookie,
        })
      ).status,
    ).toBe(200);

    const empty = await req("GET", "/api/courses", { cookie: studentCookie });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toHaveLength(0);

    expect(
      (
        await req("DELETE", `/api/admin/modules/${moduleId}`, {
          cookie: adminCookie,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await req("DELETE", `/api/admin/courses/${courseId}`, {
          cookie: adminCookie,
        })
      ).status,
    ).toBe(200);
  });

  // -- Test 5: Admin dashboard --
  it("admin: submissions and student list", async () => {
    const subs = await req("GET", "/api/admin/submissions", {
      cookie: adminCookie,
    });
    expect(subs.status).toBe(200);
    const subList = await subs.json();
    expect(subList.length).toBeGreaterThanOrEqual(1);
    const sub = subList.find((s: any) => s.email === "jane@example.com");
    expect(sub).toBeTruthy();
    expect(sub.is_read).toBe(false);

    const patch = await req("PATCH", `/api/admin/submissions/${sub.id}`, {
      body: { is_read: true },
      cookie: adminCookie,
    });
    expect(patch.status).toBe(200);

    const students = await req("GET", "/api/admin/students", {
      cookie: adminCookie,
    });
    expect(students.status).toBe(200);
    const studentList = await students.json();
    expect(studentList.some((s: any) => s.username === "student1")).toBe(true);
  });

  // -- Test 6: Authorization --
  it("authorization: access control", async () => {
    const unauth = await req("GET", "/api/courses");
    expect(unauth.status).toBe(401);

    const studentAdmin = await req("GET", "/api/admin/courses", {
      cookie: studentCookie,
    });
    expect(studentAdmin.status).toBe(403);

    const meNoAuth = await req("GET", "/api/me");
    expect(meNoAuth.status).toBe(200);
    const meBody = await meNoAuth.json();
    expect(meBody.user).toBeNull();
  });
});
