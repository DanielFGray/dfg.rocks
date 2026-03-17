import { describe, beforeAll, afterAll, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import pg from "pg";
import { execSync } from "child_process";
import { mkdirSync } from "fs";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  GenericContainer,
  type StartedTestContainer,
} from "testcontainers";

// ── Shared state ──────────────────────────────────────────────────────
let handler: (request: Request) => Promise<Response>;
let disposeHandler: () => Promise<void>;
let testDb: pg.Client;
let pgContainer: StartedPostgreSqlContainer;
let valkeyContainer: StartedTestContainer;

let adminCookie: string;
let studentCookie: string;
let studentId: string;

// ── Helpers ───────────────────────────────────────────────────────────
function req(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "X-Requested-With": "fibrae",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.cookie) headers["Cookie"] = `session=${opts.cookie}`;
  return handler(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

function getCookie(res: Response): string | null {
  const header = res.headers.get("set-cookie");
  if (!header) return null;
  const match = header.match(/session=([^;]+)/);
  return match?.[1] ?? null;
}

async function json(res: Response) {
  return res.json();
}

// ── Setup / Teardown ──────────────────────────────────────────────────
describe("DFG Portal API", () => {
  beforeAll(async () => {
    // 1. Start containers in parallel
    const [pgC, vkC] = await Promise.all([
      new PostgreSqlContainer("postgres:17-alpine")
        .withUsername("postgres")
        .withPassword("postgres")
        .start(),
      new GenericContainer("valkey/valkey:8-alpine")
        .withExposedPorts(6379)
        .start(),
    ]);
    pgContainer = pgC;
    valkeyContainer = vkC;

    const pgHost = pgC.getHost();
    const pgPort = pgC.getMappedPort(5432);
    const vkHost = vkC.getHost();
    const vkPort = vkC.getMappedPort(6379);

    const ownerPass = "owner_pass";
    const authPass = "auth_pass";
    const shadowPass = "shadow_pass";

    const rootUrl = `postgres://postgres:postgres@${pgHost}:${pgPort}/template1`;
    const dbUrl = `postgres://dfg_portal:${ownerPass}@${pgHost}:${pgPort}/dfg_portal`;
    const shadowUrl = `postgres://dfg_portal_shadow:${shadowPass}@${pgHost}:${pgPort}/dfg_portal_shadow`;

    // 2. Env for child processes (dbSetup + graphile-migrate)
    const childEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ROOT_DATABASE_URL: rootUrl,
      DATABASE_NAME: "dfg_portal",
      DATABASE_OWNER: "dfg_portal",
      DATABASE_OWNER_PASSWORD: ownerPass,
      DATABASE_AUTHENTICATOR: "dfg_portal_authenticator",
      DATABASE_AUTHENTICATOR_PASSWORD: authPass,
      DATABASE_VISITOR: "dfg_portal_visitor",
      SHADOW_DATABASE_PASSWORD: shadowPass,
      NOCONFIRM: "1",
      DATABASE_URL: dbUrl,
      SHADOW_DATABASE_URL: shadowUrl,
    };

    // 3. Create roles + databases
    execSync("bun scripts/dbSetup.ts", {
      env: childEnv,
      stdio: "pipe",
      cwd: process.cwd(),
    });

    // Ensure generated/ dir exists (kysely-codegen writes here via afterAllMigrations)
    mkdirSync("generated", { recursive: true });

    // 4. Apply migrations (reset applies committed, watch --once applies current)
    execSync("bun -b graphile-migrate reset --erase", {
      env: childEnv,
      stdio: "pipe",
      cwd: process.cwd(),
    });
    execSync("bun -b graphile-migrate watch --once", {
      env: childEnv,
      stdio: "pipe",
      cwd: process.cwd(),
    });

    // 5. Set env vars for server modules (BEFORE dynamic import)
    Object.assign(process.env, {
      DATABASE_URL: dbUrl,
      AUTH_DATABASE_URL: `postgres://dfg_portal_authenticator:${authPass}@${pgHost}:${pgPort}/dfg_portal`,
      VALKEY_URL: `redis://${vkHost}:${vkPort}`,
      SECRET: "test-secret",
      PORT: "0",
      ADMIN_EMAIL: "admin@test.com",
      VITE_ROOT_URL: "http://localhost:3000",
      DATABASE_VISITOR: "dfg_portal_visitor",
      NODE_ENV: "test",
    });

    // 6. Seed admin user via SQL
    testDb = new pg.Client({ connectionString: dbUrl });
    await testDb.connect();
    await testDb.query(
      `select app_private.create_user($1::citext, $2::citext, $3, 'admin'::app_public.user_role, $4)`,
      ["admin", "admin@test.com", "Test Admin", "admin123"],
    );

    // 7. Dynamic import server (all assertEnv/valkey/db modules load here)
    const { HttpApiLive } = await import("../httpapi/server.js");
    const { HttpApiBuilder, HttpMiddleware, HttpServer } = await import(
      "@effect/platform"
    );
    const { Layer } = await import("effect");

    const webHandler = HttpApiBuilder.toWebHandler(
      Layer.mergeAll(HttpApiLive, HttpServer.layerContext),
      { middleware: HttpMiddleware.logger },
    );
    handler = webHandler.handler;
    disposeHandler = webHandler.dispose;

    // 8. Login as admin
    const loginRes = await req("POST", "/api/login", {
      body: { id: "admin", password: "admin123" },
    });
    adminCookie = getCookie(loginRes)!;
    if (!adminCookie) {
      const body = await loginRes.text();
      throw new Error(`Admin login failed (${loginRes.status}): ${body}`);
    }
  }, 120_000);

  afterAll(async () => {
    await disposeHandler?.();
    try {
      const { valkey } = await import("../valkey.js");
      valkey.disconnect();
    } catch {}
    await testDb?.end();
    await valkeyContainer?.stop();
    await pgContainer?.stop();
  }, 30_000);

  // ── Test 1: Public endpoints ────────────────────────────────────────
  it.effect("public: health check and contact form", () =>
    Effect.gen(function* () {
      // GET /api/health
      const health = yield* Effect.promise(() => req("GET", "/api/health"));
      expect(health.status).toBe(200);
      expect(yield* Effect.promise(() => json(health))).toEqual({
        success: true,
      });

      // POST /api/contact — valid
      const contact = yield* Effect.promise(() =>
        req("POST", "/api/contact", {
          body: {
            name: "Jane Doe",
            email: "jane@example.com",
            instrument: "piano",
            format: "in-person",
            message: "Looking for lessons",
          },
        }),
      );
      expect(contact.status).toBe(200);
      expect(yield* Effect.promise(() => json(contact))).toEqual({
        success: true,
      });

      // POST /api/contact — honeypot triggers rejection
      const spam = yield* Effect.promise(() =>
        req("POST", "/api/contact", {
          body: {
            name: "Bot",
            email: "bot@spam.com",
            instrument: "guitar",
            format: "online",
            website: "http://spam.com",
          },
        }),
      );
      expect(spam.status).toBe(400);
    }),
  );

  // ── Test 2: Auth lifecycle ──────────────────────────────────────────
  it.effect("auth: student creation, invite, login, password flows", () =>
    Effect.gen(function* () {
      // Admin creates student → invite email sent (stubbed)
      const createRes = yield* Effect.promise(() =>
        req("POST", "/api/admin/students", {
          body: {
            username: "student1",
            email: "student1@test.com",
            name: "Test Student",
          },
          cookie: adminCookie,
        }),
      );
      expect(createRes.status).toBe(200);
      const student = yield* Effect.promise(() => json(createRes));
      expect(student.username).toBe("student1");
      studentId = student.id;

      // Read invite token from DB
      const secrets = yield* Effect.promise(async () => {
        const { rows } = await testDb.query(
          "select invite_token from app_private.user_secrets where user_id = $1",
          [studentId],
        );
        return rows[0];
      });
      expect(secrets.invite_token).toBeTruthy();

      // Set password with invite token → auto-login
      const setPassRes = yield* Effect.promise(() =>
        req("POST", "/api/set-password", {
          body: { token: secrets.invite_token, password: "student123" },
        }),
      );
      expect(setPassRes.status).toBe(200);
      const setPassCookie = getCookie(setPassRes);
      expect(setPassCookie).toBeTruthy();

      // GET /me — authenticated
      const me1 = yield* Effect.promise(() =>
        req("GET", "/api/me", { cookie: setPassCookie! }),
      );
      expect(me1.status).toBe(200);
      const me1Body = yield* Effect.promise(() => json(me1));
      expect(me1Body.user.username).toBe("student1");

      // Logout
      const logout = yield* Effect.promise(() =>
        req("POST", "/api/logout", { cookie: setPassCookie! }),
      );
      expect(logout.status).toBe(200);

      // Login with password
      const loginRes = yield* Effect.promise(() =>
        req("POST", "/api/login", {
          body: { id: "student1", password: "student123" },
        }),
      );
      expect(loginRes.status).toBe(200);
      studentCookie = getCookie(loginRes)!;
      expect(studentCookie).toBeTruthy();

      // Forgot password → reset token generated
      const forgotRes = yield* Effect.promise(() =>
        req("POST", "/api/forgot-password", {
          body: { email: "student1@test.com" },
        }),
      );
      expect(forgotRes.status).toBe(200);

      // Read reset token from DB
      const resetSecrets = yield* Effect.promise(async () => {
        const { rows } = await testDb.query(
          "select reset_password_token from app_private.user_secrets where user_id = $1",
          [studentId],
        );
        return rows[0];
      });
      expect(resetSecrets.reset_password_token).toBeTruthy();

      // Reset password → auto-login
      const resetRes = yield* Effect.promise(() =>
        req("POST", "/api/reset-password", {
          body: {
            token: resetSecrets.reset_password_token,
            password: "newpass123",
          },
        }),
      );
      expect(resetRes.status).toBe(200);
      studentCookie = getCookie(resetRes)!;
      expect(studentCookie).toBeTruthy();

      // Verify new session
      const me2 = yield* Effect.promise(() =>
        req("GET", "/api/me", { cookie: studentCookie }),
      );
      expect(me2.status).toBe(200);
      expect(
        (yield* Effect.promise(() => json(me2))).user.username,
      ).toBe("student1");
    }),
  );

  // ── Test 3: Curriculum CRUD + student access ────────────────────────
  it.effect("curriculum: admin CRUD, enrollment, student views", () =>
    Effect.gen(function* () {
      // Create course
      const createCourse = yield* Effect.promise(() =>
        req("POST", "/api/admin/courses", {
          body: {
            title: "Guitar 101",
            instrument: "guitar",
            description: "Beginner guitar",
          },
          cookie: adminCookie,
        }),
      );
      expect(createCourse.status).toBe(200);
      const course = yield* Effect.promise(() => json(createCourse));
      const courseId = course.id;
      expect(course.title).toBe("Guitar 101");

      // Update course
      const updateCourse = yield* Effect.promise(() =>
        req("PATCH", `/api/admin/courses/${courseId}`, {
          body: { description: "Updated beginner guitar" },
          cookie: adminCookie,
        }),
      );
      expect(updateCourse.status).toBe(200);
      expect(
        (yield* Effect.promise(() => json(updateCourse))).description,
      ).toBe("Updated beginner guitar");

      // Create module
      const createMod = yield* Effect.promise(() =>
        req("POST", `/api/admin/courses/${courseId}/modules`, {
          body: { title: "Week 1: Basics", sort_order: 1 },
          cookie: adminCookie,
        }),
      );
      expect(createMod.status).toBe(200);
      const mod = yield* Effect.promise(() => json(createMod));
      const moduleId = mod.id;

      // Update module
      const updateMod = yield* Effect.promise(() =>
        req("PATCH", `/api/admin/modules/${moduleId}`, {
          body: { description: "Fundamentals" },
          cookie: adminCookie,
        }),
      );
      expect(updateMod.status).toBe(200);

      // Seed materials via DB (no upload endpoint yet)
      const globalMat = yield* Effect.promise(async () => {
        const { rows } = await testDb.query(
          `insert into app_public.materials (title, original_filename, file_path, mime_type, file_size, is_global)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [
            "Chord Chart",
            "chords.pdf",
            "/data/chords.pdf",
            "application/pdf",
            12345,
            true,
          ],
        );
        return rows[0];
      });
      const privateMat = yield* Effect.promise(async () => {
        const { rows } = await testDb.query(
          `insert into app_public.materials (title, original_filename, file_path, mime_type, file_size, is_global)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [
            "Private Notes",
            "notes.pdf",
            "/data/notes.pdf",
            "application/pdf",
            5432,
            false,
          ],
        );
        return rows[0];
      });

      // Attach global material to module
      const attach = yield* Effect.promise(() =>
        req("POST", `/api/admin/modules/${moduleId}/materials`, {
          body: { material_id: globalMat.id, sort_order: 1 },
          cookie: adminCookie,
        }),
      );
      expect(attach.status).toBe(200);

      // Enroll student in course
      const enroll = yield* Effect.promise(() =>
        req("POST", `/api/admin/students/${studentId}/enroll`, {
          body: { course_id: courseId },
          cookie: adminCookie,
        }),
      );
      expect(enroll.status).toBe(200);

      // Assign private material to student
      const assign = yield* Effect.promise(() =>
        req("POST", `/api/admin/students/${studentId}/assign`, {
          body: { material_id: privateMat.id },
          cookie: adminCookie,
        }),
      );
      expect(assign.status).toBe(200);

      // Admin lists courses
      const adminCourses = yield* Effect.promise(() =>
        req("GET", "/api/admin/courses", { cookie: adminCookie }),
      );
      expect(adminCourses.status).toBe(200);
      expect(
        (yield* Effect.promise(() => json(adminCourses))).length,
      ).toBeGreaterThanOrEqual(1);

      // ── Student views ──
      // Student courses (enrolled)
      const courses = yield* Effect.promise(() =>
        req("GET", "/api/courses", { cookie: studentCookie }),
      );
      expect(courses.status).toBe(200);
      const courseList = yield* Effect.promise(() => json(courses));
      expect(courseList).toHaveLength(1);
      expect(courseList[0].title).toBe("Guitar 101");

      // Course detail with modules + materials
      const detail = yield* Effect.promise(() =>
        req("GET", `/api/courses/${courseId}`, { cookie: studentCookie }),
      );
      expect(detail.status).toBe(200);
      const courseDetail = yield* Effect.promise(() => json(detail));
      expect(courseDetail.modules).toHaveLength(1);
      expect(courseDetail.modules[0].materials).toHaveLength(1);
      expect(courseDetail.modules[0].materials[0].title).toBe("Chord Chart");

      // Library (global materials)
      const library = yield* Effect.promise(() =>
        req("GET", "/api/library", { cookie: studentCookie }),
      );
      expect(library.status).toBe(200);
      const libraryList = yield* Effect.promise(() => json(library));
      expect(
        libraryList.some((m: any) => m.title === "Chord Chart"),
      ).toBe(true);

      // Assignments (student-specific materials)
      const assignments = yield* Effect.promise(() =>
        req("GET", "/api/assignments", { cookie: studentCookie }),
      );
      expect(assignments.status).toBe(200);
      const assignList = yield* Effect.promise(() => json(assignments));
      expect(
        assignList.some((m: any) => m.title === "Private Notes"),
      ).toBe(true);

      // ── Cleanup (exercises detach, unassign, unenroll, delete) ──
      const detach = yield* Effect.promise(() =>
        req(
          "DELETE",
          `/api/admin/modules/${moduleId}/materials/${globalMat.id}`,
          { cookie: adminCookie },
        ),
      );
      expect(detach.status).toBe(200);

      const unassign = yield* Effect.promise(() =>
        req(
          "DELETE",
          `/api/admin/students/${studentId}/assign/${privateMat.id}`,
          { cookie: adminCookie },
        ),
      );
      expect(unassign.status).toBe(200);

      const unenroll = yield* Effect.promise(() =>
        req(
          "DELETE",
          `/api/admin/students/${studentId}/enroll/${courseId}`,
          { cookie: adminCookie },
        ),
      );
      expect(unenroll.status).toBe(200);

      // Verify student no longer sees courses
      const empty = yield* Effect.promise(() =>
        req("GET", "/api/courses", { cookie: studentCookie }),
      );
      expect(empty.status).toBe(200);
      expect(yield* Effect.promise(() => json(empty))).toHaveLength(0);

      // Delete module
      const delMod = yield* Effect.promise(() =>
        req("DELETE", `/api/admin/modules/${moduleId}`, {
          cookie: adminCookie,
        }),
      );
      expect(delMod.status).toBe(200);

      // Delete course
      const delCourse = yield* Effect.promise(() =>
        req("DELETE", `/api/admin/courses/${courseId}`, {
          cookie: adminCookie,
        }),
      );
      expect(delCourse.status).toBe(200);
    }),
  );

  // ── Test 4: Admin dashboard ─────────────────────────────────────────
  it.effect("admin: submissions and student list", () =>
    Effect.gen(function* () {
      // Submissions includes the contact form from test 1
      const subs = yield* Effect.promise(() =>
        req("GET", "/api/admin/submissions", { cookie: adminCookie }),
      );
      expect(subs.status).toBe(200);
      const subList = yield* Effect.promise(() => json(subs));
      expect(subList.length).toBeGreaterThanOrEqual(1);
      const sub = subList.find(
        (s: any) => s.email === "jane@example.com",
      );
      expect(sub).toBeTruthy();
      expect(sub.is_read).toBe(false);

      // Mark as read
      const patch = yield* Effect.promise(() =>
        req("PATCH", `/api/admin/submissions/${sub.id}`, {
          body: { is_read: true },
          cookie: adminCookie,
        }),
      );
      expect(patch.status).toBe(200);

      // Student list includes created student
      const students = yield* Effect.promise(() =>
        req("GET", "/api/admin/students", { cookie: adminCookie }),
      );
      expect(students.status).toBe(200);
      const studentList = yield* Effect.promise(() => json(students));
      expect(
        studentList.some((s: any) => s.username === "student1"),
      ).toBe(true);
    }),
  );

  // ── Test 5: Authorization ───────────────────────────────────────────
  it.effect("authorization: access control", () =>
    Effect.gen(function* () {
      // Unauthenticated → protected endpoint rejects
      const unauth = yield* Effect.promise(() => req("GET", "/api/courses"));
      expect(unauth.status).toBe(401);

      // Student → admin endpoint rejects (403 Forbidden, not 401)
      const studentAdmin = yield* Effect.promise(() =>
        req("GET", "/api/admin/courses", { cookie: studentCookie }),
      );
      expect(studentAdmin.status).toBe(403);

      // /me without auth → 200 with null user (not 401)
      const meNoAuth = yield* Effect.promise(() => req("GET", "/api/me"));
      expect(meNoAuth.status).toBe(200);
      const meBody = yield* Effect.promise(() => json(meNoAuth));
      expect(meBody.user).toBeNull();
    }),
  );
});
