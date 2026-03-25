import { describe, beforeAll, afterAll, expect, it } from "vitest";
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

// -- Shared state --
let handler: (request: Request) => Promise<Response>;
let testDb: pg.Client;
let pgContainer: StartedPostgreSqlContainer;
let valkeyContainer: StartedTestContainer;

let adminCookie: string;
let studentCookie: string;
let studentId: string;

// -- Helpers --
function req(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "X-Requested-With": "dfg",
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

// -- Setup / Teardown --
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

    // 2. Env for child processes
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

    mkdirSync("generated", { recursive: true });

    // 4. Apply migrations (worker:schema creates graphile_worker schema needed by migrations)
    execSync("bun -b graphile-migrate reset --erase", {
      env: childEnv,
      stdio: "pipe",
      cwd: process.cwd(),
    });
    execSync("cd worker && bun -b graphile-worker --schema-only", {
      env: { ...childEnv, DATABASE_URL: dbUrl },
      stdio: "pipe",
      cwd: process.cwd(),
    });
    execSync("bun -b graphile-migrate watch --once", {
      env: childEnv,
      stdio: "pipe",
      cwd: process.cwd(),
    });

    // 5. Set env vars for server modules
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
    const adminResult = await testDb.query(
      `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
      ["admin", "Test Admin", "admin@test.com", "admin123"],
    );
    await testDb.query(
      `update app_public.users set role = 'admin' where id = $1`,
      [adminResult.rows[0].id],
    );

    // 7. Dynamic import Elysia app
    const { app } = await import("../app.js");
    handler = (request: Request) => app.fetch(request);

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
    // Close DB pools before stopping containers to avoid connection-reset errors
    try {
      const db = await import("../db.js");
      await db.rootDb.destroy();
      await db.authDb.destroy();
    } catch {}
    try {
      const { valkey } = await import("../valkey.js");
      valkey.disconnect();
    } catch {}
    await testDb?.end();
    await valkeyContainer?.stop();
    await pgContainer?.stop();
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
    // Create student via SQL
    const studentResult = await testDb.query(
      `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
      ["student1", "Test Student", "student1@test.com", "student123"],
    );
    studentId = studentResult.rows[0].id;

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

  // -- Test 3: Curriculum CRUD + student access --
  it("curriculum: admin CRUD, enrollment, student views", async () => {
    // Create course
    const createCourse = await req("POST", "/api/admin/courses", {
      body: { title: "Guitar 101", instrument: "guitar", description: "Beginner guitar" },
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
      body: { description: "Fundamentals" },
      cookie: adminCookie,
    });
    expect(updateMod.status).toBe(200);

    // Seed materials via DB
    const globalMat = (await testDb.query(
      `insert into app_public.materials (title, original_filename, file_path, mime_type, file_size, is_global)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      ["Chord Chart", "chords.pdf", "/data/chords.pdf", "application/pdf", 12345, true],
    )).rows[0];

    const privateMat = (await testDb.query(
      `insert into app_public.materials (title, original_filename, file_path, mime_type, file_size, is_global)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      ["Private Notes", "notes.pdf", "/data/notes.pdf", "application/pdf", 5432, false],
    )).rows[0];

    // Attach global material to module
    const attach = await req("POST", `/api/admin/modules/${moduleId}/materials`, {
      body: { material_id: globalMat.id, sort_order: 1 },
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
    const adminCourses = await req("GET", "/api/admin/courses", { cookie: adminCookie });
    expect(adminCourses.status).toBe(200);
    expect((await adminCourses.json()).length).toBeGreaterThanOrEqual(1);

    // Student courses (enrolled)
    const courses = await req("GET", "/api/courses", { cookie: studentCookie });
    expect(courses.status).toBe(200);
    const courseList = await courses.json();
    expect(courseList).toHaveLength(1);
    expect(courseList[0].title).toBe("Guitar 101");

    // Course detail with modules + materials
    const detail = await req("GET", `/api/courses/${courseId}`, { cookie: studentCookie });
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
    const assignments = await req("GET", "/api/assignments", { cookie: studentCookie });
    expect(assignments.status).toBe(200);
    const assignList = await assignments.json();
    expect(assignList.some((m: any) => m.title === "Private Notes")).toBe(true);

    // Cleanup
    expect((await req("DELETE", `/api/admin/modules/${moduleId}/materials/${globalMat.id}`, { cookie: adminCookie })).status).toBe(200);
    expect((await req("DELETE", `/api/admin/students/${studentId}/assign/${privateMat.id}`, { cookie: adminCookie })).status).toBe(200);
    expect((await req("DELETE", `/api/admin/students/${studentId}/enroll/${courseId}`, { cookie: adminCookie })).status).toBe(200);

    const empty = await req("GET", "/api/courses", { cookie: studentCookie });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toHaveLength(0);

    expect((await req("DELETE", `/api/admin/modules/${moduleId}`, { cookie: adminCookie })).status).toBe(200);
    expect((await req("DELETE", `/api/admin/courses/${courseId}`, { cookie: adminCookie })).status).toBe(200);
  });

  // -- Test 4: Admin dashboard --
  it("admin: submissions and student list", async () => {
    const subs = await req("GET", "/api/admin/submissions", { cookie: adminCookie });
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

    const students = await req("GET", "/api/admin/students", { cookie: adminCookie });
    expect(students.status).toBe(200);
    const studentList = await students.json();
    expect(studentList.some((s: any) => s.username === "student1")).toBe(true);
  });

  // -- Test 5: Authorization --
  it("authorization: access control", async () => {
    const unauth = await req("GET", "/api/courses");
    expect(unauth.status).toBe(401);

    const studentAdmin = await req("GET", "/api/admin/courses", { cookie: studentCookie });
    expect(studentAdmin.status).toBe(403);

    const meNoAuth = await req("GET", "/api/me");
    expect(meNoAuth.status).toBe(200);
    const meBody = await meNoAuth.json();
    expect(meBody.user).toBeNull();
  });
});
