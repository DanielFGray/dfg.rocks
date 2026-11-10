import { it, expect, describe, beforeAll, afterAll, vi } from "@effect/vitest";
import * as FileSystem from "effect/FileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpBody from "effect/http/HttpBody";
import * as Cookies from "effect/http/Cookies";
import { Effect, ManagedRuntime, Layer, Option, Schedule, Stream } from "effect";
import { Logger, consoleLogFactory } from "graphile-worker";
import pg from "pg";
import generatePrepaidPeriodTask from "../../worker/tasks/lessons__generate_prepaid_period.js";
import { StorageService } from "../services/storageService.js";
import type { MonthlyPaymentStatus } from "../../shared/schemas.js";

let testDb: pg.Pool;
let adminCookie: string;
let studentCookie: string;
let studentId: string;
let rt: ManagedRuntime.ManagedRuntime<any, any>;

const testApplePrivateKey = "-----BEGIN PRIVATE KEY-----\\nAQAB\\n-----END PRIVATE KEY-----";

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

function runPlatform<A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
}

const TEST_ROOT_URL = "http://127.0.0.1:3000";
// The server's VITE_ROOT_URL. It differs from TEST_ROOT_URL as it does in production, where
// Traefik ends TLS and the app receives plain-HTTP requests: OAuth redirect URIs must come from
// this value, not from the request.
const CONFIGURED_ROOT_URL = "https://dfg.test";
type TitledItem = { title: string };
type SubmissionSummary = { id: string; email: string; is_read: boolean };
type StudentSummary = { username: string };

function makeTestRequest(
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  opts: { body?: unknown; cookie?: string; csrf?: boolean } = {},
): HttpClientRequest.HttpClientRequest {
  const headers: Record<string, string> = {};
  if (opts.csrf !== false) headers["X-Requested-With"] = "dfg";
  if (opts.cookie) headers["Cookie"] = `session=${opts.cookie}`;

  const url = `${TEST_ROOT_URL}${path}`;
  const body: HttpBody.HttpBody | undefined =
    opts.body instanceof FormData
      ? HttpBody.formData(opts.body)
      : opts.body !== undefined
        ? HttpBody.text(JSON.stringify(opts.body), "application/json")
        : undefined;

  return HttpClientRequest.make(method)(url, { headers, body });
}

function getCookie(res: HttpClientResponse.HttpClientResponse): string | null {
  return Option.getOrElse(Cookies.getValue(res.cookies, "session"), () => null);
}

function hasCookie(res: HttpClientResponse.HttpClientResponse, name: string): boolean {
  return Option.isSome(Cookies.getValue(res.cookies, name));
}

function cookieIdFromToken(token: string): string {
  return token.split(".")[0] ?? "";
}

function reqEffect(
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  opts: { body?: unknown; cookie?: string; csrf?: boolean } = {},
) {
  return Effect.tryPromise(() =>
    rt.runPromise(HttpClient.execute(makeTestRequest(method, path, opts))),
  );
}

function resJson(res: HttpClientResponse.HttpClientResponse): Effect.Effect<any, Error> {
  return Effect.tryPromise(() => rt.runPromise(res.json));
}

describe("DFG Portal API", () => {
  beforeAll(async () => {
    const dbUrl = forceIpv4(requiredEnv("DATABASE_URL"));
    const authDbUrl = forceIpv4(requiredEnv("AUTH_DATABASE_URL"));
    const adminEmail = process.env.ADMIN_EMAIL || "admin@test.com";
    const childEnv = Object.fromEntries(
      Object.entries({
        ...process.env,
        DATABASE_URL: dbUrl,
        AUTH_DATABASE_URL: authDbUrl,
        NOCONFIRM: "1",
        NODE_ENV: "test",
        PORT: "0",
        VITE_ROOT_URL: CONFIGURED_ROOT_URL,
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
    Object.assign(process.env, childEnv);

    await runPlatform(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.makeDirectory("generated", { recursive: true });
      }),
    );

    vi.resetModules();

    testDb = new pg.Pool({ connectionString: dbUrl });
    const adminResult = await testDb.query(
      `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
      ["admin", "Test Admin", "admin@test.com", "admin123"],
    );
    await testDb.query(`update app_public.users set role = 'admin' where id = $1`, [
      adminResult.rows[0].id,
    ]);

    const { handleApiRequest } = await import("../app.js");

    const httpClient = HttpClient.make((request, url, _signal, _fiber) =>
      Effect.tryPromise({
        try: async () => {
          let body: globalThis.BodyInit | undefined = undefined;
          switch (request.body._tag) {
            case "Raw":
            case "Uint8Array":
              body = request.body.body as any;
              break;
            case "FormData":
              body = request.body.formData;
              break;
          }
          const res = await handleApiRequest(
            new Request(url, { method: request.method, headers: request.headers, body }),
          );
          return HttpClientResponse.fromWeb(request, res);
        },
        catch: (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause }),
          }),
      }),
    );

    rt = ManagedRuntime.make(Layer.succeed(HttpClient.HttpClient, httpClient));

    const adminLoginRes = await Effect.runPromise(
      reqEffect("POST", "/api/login", {
        body: { id: "admin", password: "admin123" },
      }),
    );
    adminCookie = getCookie(adminLoginRes)!;
    if (!adminCookie)
      throw new Error(
        `Admin login failed (${adminLoginRes.status}): ${await rt.runPromise(adminLoginRes.text)}`,
      );

    const studentResult = await testDb.query(
      `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
      ["student1", "Test Student", "student1@test.com", "student123"],
    );
    studentId = studentResult.rows[0].id;

    const studentLoginRes = await Effect.runPromise(
      reqEffect("POST", "/api/login", {
        body: { id: "student1", password: "student123" },
      }),
    );
    studentCookie = getCookie(studentLoginRes)!;
    if (!studentCookie)
      throw new Error(
        `Student login failed (${studentLoginRes.status}): ${await rt.runPromise(studentLoginRes.text)}`,
      );
  }, 120_000);

  afterAll(async () => {
    await testDb?.end();
  }, 30_000);

  it.effect(
    "public: health check and contact form",
    Effect.fnUntraced(function* () {
      const health = yield* reqEffect("GET", "/healthz");
      expect(health.status).toBe(200);
      expect(yield* resJson(health)).toEqual({ status: "ok", commit: expect.any(String) });

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
      expect(yield* resJson(contact)).toEqual({ success: true });

      const emailJobs = yield* Effect.tryPromise(() =>
        testDb.query(
          `select jobs.payload
             from graphile_worker._private_jobs jobs
             join graphile_worker._private_tasks tasks on tasks.id = jobs.task_id
             where tasks.identifier = 'send_email'
               and jobs.payload ->> 'template' = 'contact_submission.mjml'
               and jobs.payload -> 'variables' ->> 'email' = $1`,
          ["jane@example.com"],
        ),
      );
      expect(emailJobs.rows).toHaveLength(1);

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

  it.effect(
    "auth: login, password flows",
    Effect.fnUntraced(function* () {
      const loginRes = yield* reqEffect("POST", "/api/login", {
        body: { id: "student1", password: "student123" },
      });
      expect(loginRes.status).toBe(200);
      studentCookie = getCookie(loginRes)!;
      expect(studentCookie).toBeTruthy();

      const me = yield* reqEffect("GET", "/api/me", { cookie: studentCookie });
      expect(me.status).toBe(200);
      expect((yield* resJson(me)).user.username).toBe("student1");

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
      expect((yield* resJson(me2)).user.username).toBe("student1");
    }),
  );

  it.effect(
    "auth: admin authorization follows live DB session and role state",
    Effect.fnUntraced(function* () {
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

  it.effect(
    "auth: oauth start routes redirect and callbacks require valid state",
    Effect.fnUntraced(function* () {
      const googleStart = yield* reqEffect("GET", "/api/oauth/google?redirect=%2Fsettings");
      expect(googleStart.status).toBe(302);
      expect(googleStart.headers["location"]).toMatch(
        /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/,
      );
      const googleLocation = new URL(googleStart.headers["location"]!);
      expect(googleLocation.searchParams.get("client_id")).toBe(process.env.GOOGLE_CLIENT_ID);
      expect(googleLocation.searchParams.get("access_type")).toBe("offline");
      expect(googleLocation.searchParams.get("redirect_uri")).toBe(
        `${CONFIGURED_ROOT_URL}/api/oauth/google/callback`,
      );
      expect(googleLocation.searchParams.get("code_challenge")).toBeTruthy();
      expect(googleLocation.searchParams.get("state")).toBeTruthy();
      expect(googleStart.cookies.cookies["oauth_google"]).toBeTruthy();
      expect(googleStart.cookies.cookies["oauth_google_redirect"]).toBeTruthy();
      expect(googleStart.headers["set-cookie"]).toContain("SameSite=Lax");

      const googleCallback = yield* reqEffect(
        "GET",
        `/api/oauth/google/callback?code=fake-code&state=${googleLocation.searchParams.get("state")!}`,
      );
      expect(googleCallback.status).toBe(400);
      expect(yield* resJson(googleCallback)).toEqual({
        error: "Invalid or expired Google OAuth state",
      });

      const appleStart = yield* reqEffect("GET", "/api/oauth/apple?redirect=%2Fdashboard");
      expect(appleStart.status).toBe(302);
      expect(appleStart.headers["location"]).toMatch(
        /^https:\/\/appleid\.apple\.com\/auth\/authorize\?/,
      );
      const appleLocation = new URL(appleStart.headers["location"]!);
      expect(appleLocation.searchParams.get("client_id")).toBe(process.env.APPLE_CLIENT_ID);
      expect(appleLocation.searchParams.get("redirect_uri")).toBe(
        `${CONFIGURED_ROOT_URL}/api/oauth/apple/callback`,
      );
      expect(appleLocation.searchParams.get("response_mode")).toBe("form_post");
      expect(appleLocation.searchParams.get("state")).toBeTruthy();
      expect(appleStart.cookies.cookies["oauth_apple"]).toBeTruthy();
      expect(appleStart.cookies.cookies["oauth_apple_redirect"]).toBeTruthy();
      expect(appleStart.headers["set-cookie"]).toContain("SameSite=None");

      const appleCallbackForm = new FormData();
      appleCallbackForm.append("code", "fake-code");
      appleCallbackForm.append("state", appleLocation.searchParams.get("state")!);
      const appleCallback = yield* reqEffect("POST", "/api/oauth/apple/callback", {
        body: appleCallbackForm,
      });
      expect(appleCallback.status).toBe(400);
      expect(yield* resJson(appleCallback)).toEqual({
        error: "Invalid or expired Apple OAuth state",
      });
    }),
  );

  it.effect(
    "admin: gcal connect redirects and callback requires valid state",
    Effect.fnUntraced(function* () {
      const connect = yield* reqEffect("GET", "/api/admin/gcal/connect", {
        cookie: adminCookie,
        csrf: false,
      });
      expect(connect.status).toBe(302);
      const location = connect.headers["location"];
      expect(location).toBeTruthy();
      const authUrl = new URL(location!);
      expect(authUrl.origin).toBe("https://accounts.google.com");
      expect(authUrl.pathname).toBe("/o/oauth2/v2/auth");
      expect(authUrl.searchParams.get("client_id")).toBe(process.env.GOOGLE_CALENDAR_CLIENT_ID);
      expect(authUrl.searchParams.get("access_type")).toBe("offline");
      expect(authUrl.searchParams.get("redirect_uri")).toBe(
        `${CONFIGURED_ROOT_URL}/api/admin/gcal/callback`,
      );
      expect(authUrl.searchParams.get("code_challenge")).toBeTruthy();
      expect(authUrl.searchParams.get("state")).toBeTruthy();
      expect(hasCookie(connect, "gcal_oauth")).toBeTruthy();
      expect(connect.headers["set-cookie"]).toContain("SameSite=Lax");

      const callback = yield* reqEffect(
        "GET",
        `/api/admin/gcal/callback?code=fake-code&state=${authUrl.searchParams.get("state")!}`,
        { cookie: adminCookie, csrf: false },
      );
      expect(callback.status).toBe(400);
      expect(yield* resJson(callback)).toEqual({
        error: "Invalid or expired Google Calendar OAuth state",
      });
    }),
  );

  it.effect(
    "materials: upload dedupes by hash and repairs missing blobs",
    Effect.fnUntraced(function* () {
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
      const firstMaterial = yield* resJson(firstUpload);
      expect(firstMaterial.title).toBe("Original Title");
      expect(firstMaterial.original_filename).toBe("original-upload.pdf");
      expect(firstMaterial.is_global).toBe(true);

      const firstRow = (yield* Effect.tryPromise(() =>
        testDb.query(
          `select id, content_hash, storage_backend, storage_key from app_public.materials where id = $1`,
          [(firstMaterial as any).id],
        ),
      )).rows[0];
      expect(firstRow.content_hash).toBeTruthy();

      yield* StorageService.use((storageService) =>
        storageService.delete({
          storageBackend: firstRow.storage_backend,
          storageKey: firstRow.storage_key,
        }),
      ).pipe(Effect.provide(StorageService.layer), Effect.provide(NodeFileSystem.layer));

      const missingDownload = yield* reqEffect(
        "GET",
        `/api/materials/${(firstMaterial as any).id}/download`,
        { cookie: adminCookie },
      );
      expect(missingDownload.status).toBe(500);
      expect(yield* resJson(missingDownload)).toEqual({
        error: "Internal Server Error",
      });

      const secondUpload = yield* uploadMaterial("Conflicting Title", "renamed-upload.pdf", false);
      expect(secondUpload.status).toBe(200);
      const secondMaterial = yield* resJson(secondUpload);
      expect(secondMaterial.id).toBe((firstMaterial as any).id);
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
        yield* StorageService.use((storageService) =>
          storageService.exists({
            storageBackend: firstRow.storage_backend,
            storageKey: firstRow.storage_key,
          }),
        ).pipe(Effect.provide(StorageService.layer), Effect.provide(NodeFileSystem.layer)),
      ).toBe(true);
    }),
  );

  it.effect(
    "messages: student can send a message to staff",
    Effect.fnUntraced(function* () {
      const create = yield* reqEffect("POST", "/api/messages", {
        body: { body: "Can we move this week's lesson to Friday?" },
        cookie: studentCookie,
      });
      expect(create.status).toBe(200);
      const created = yield* resJson(create);
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

  it.effect(
    "assignments: tracks playback time and self-reviews",
    Effect.fnUntraced(function* () {
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
      expect((yield* resJson(playback1)).listened_seconds).toBe(35);

      const review1 = yield* reqEffect("POST", `/api/assignments/${notationMat.id}/reviews`, {
        body: { stars: 4 },
        cookie: studentCookie,
      });
      expect(review1.status).toBe(200);
      const review1Body = yield* resJson(review1);
      expect(review1Body.stars).toBe(4);
      expect(review1Body.listened_seconds).toBe(35);

      const playback2 = yield* reqEffect("POST", `/api/assignments/${notationMat.id}/playback`, {
        body: { seconds: 25 },
        cookie: studentCookie,
      });
      expect(playback2.status).toBe(200);
      expect((yield* resJson(playback2)).listened_seconds).toBe(60);

      const review2 = yield* reqEffect("POST", `/api/assignments/${notationMat.id}/reviews`, {
        body: { stars: 5 },
        cookie: studentCookie,
      });
      expect(review2.status).toBe(200);
      const review2Body = yield* resJson(review2);
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

  it.effect(
    "curriculum: admin CRUD, enrollment, student views",
    Effect.fnUntraced(function* () {
      const createCourse = yield* reqEffect("POST", "/api/admin/courses", {
        body: { title: "Guitar 101", instrument: "guitar", description: "Beginner guitar" },
        cookie: adminCookie,
      });
      expect(createCourse.status).toBe(200);
      const course = yield* resJson(createCourse);
      const courseId = course.id;
      expect(course.title).toBe("Guitar 101");

      const updateCourse = yield* reqEffect("PATCH", `/api/admin/courses/${courseId}`, {
        body: { description: "Updated beginner guitar" },
        cookie: adminCookie,
      });
      expect(updateCourse.status).toBe(200);
      expect((yield* resJson(updateCourse)).description).toBe("Updated beginner guitar");

      const createMod = yield* reqEffect("POST", `/api/admin/courses/${courseId}/modules`, {
        body: { title: "Week 1: Basics", sort_order: 1 },
        cookie: adminCookie,
      });
      expect(createMod.status).toBe(200);
      const mod = yield* resJson(createMod);
      const moduleId = mod.id;

      const updateMod = yield* reqEffect("PATCH", `/api/admin/modules/${moduleId}`, {
        body: { title: "Week 1: Fundamentals" },
        cookie: adminCookie,
      });
      expect(updateMod.status).toBe(200);
      expect((yield* resJson(updateMod)).title).toBe("Week 1: Fundamentals");
      const notADocument = yield* reqEffect("PATCH", `/api/admin/modules/${moduleId}`, {
        body: { content: { type: "paragraph", content: "text" } },
        cookie: adminCookie,
      });
      expect(notADocument.status).toBe(400);

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
      expect((yield* resJson(adminCourses)).length).toBeGreaterThanOrEqual(1);

      const courses = yield* reqEffect("GET", "/api/courses", { cookie: studentCookie });
      expect(courses.status).toBe(200);
      const courseList = yield* resJson(courses);
      expect(courseList).toHaveLength(1);
      expect(courseList[0].title).toBe("Guitar 101");

      const detail = yield* reqEffect("GET", `/api/courses/${courseId}`, { cookie: studentCookie });
      expect(detail.status).toBe(200);
      const courseDetail = yield* resJson(detail);
      expect(courseDetail.modules).toHaveLength(1);
      expect(courseDetail.modules[0].materials).toHaveLength(1);
      expect(courseDetail.modules[0].materials[0].title).toBe("Chord Chart");

      const library = yield* reqEffect("GET", "/api/library", { cookie: studentCookie });
      expect(library.status).toBe(200);
      const libraryList = (yield* resJson(library)) as TitledItem[];
      expect(libraryList.some((material) => material.title === "Chord Chart")).toBe(true);

      const assignments = yield* reqEffect("GET", "/api/assignments", { cookie: studentCookie });
      expect(assignments.status).toBe(200);
      const assignList = (yield* resJson(assignments)) as TitledItem[];
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
      expect(yield* resJson(empty)).toHaveLength(0);

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

  it.effect(
    "admin: submissions and student list",
    Effect.fnUntraced(function* () {
      const subs = yield* reqEffect("GET", "/api/admin/submissions", { cookie: adminCookie });
      expect(subs.status).toBe(200);
      const subList = (yield* resJson(subs)) as SubmissionSummary[];
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
      const studentList = (yield* resJson(students)) as StudentSummary[];
      expect(studentList.some((student) => student.username === "student1")).toBe(true);
    }),
  );

  it.effect(
    "admin: working hours reject invalid times and read back what was saved",
    Effect.fnUntraced(function* () {
      const path = "/api/admin/working-hours";
      const weekday = { start: "09:00", end: "17:00" };
      const hours = { 0: null, 1: weekday, 2: weekday, 3: null, 4: weekday, 5: weekday, 6: null };
      for (const day of [
        { start: "17:00", end: "09:00" },
        { start: "9am", end: "17:00" },
      ]) {
        const rejected = yield* reqEffect("POST", path, {
          cookie: adminCookie,
          body: { ...hours, 3: day },
        });
        expect(rejected.status).toBe(400);
      }
      expect((yield* reqEffect("POST", path, { cookie: adminCookie, body: hours })).status).toBe(
        200,
      );
      expect(yield* resJson(yield* reqEffect("GET", path, { cookie: adminCookie }))).toEqual(hours);
    }),
  );

  it.effect(
    "admin: recurring prepaid payments validate, enqueue, and upsert idempotently",
    Effect.fnUntraced(function* () {
      const path = `/api/admin/students/${studentId}/monthly-payments`;
      expect((yield* reqEffect("GET", path)).status).toBe(401);
      expect((yield* reqEffect("GET", path, { cookie: studentCookie })).status).toBe(403);

      const rateResponse = yield* reqEffect("POST", "/api/admin/student-rates", {
        cookie: adminCookie,
        body: {
          student_id: studentId,
          rate_cents: 18000,
          lesson_duration_minutes: 60,
          location_type: "online",
          billing_model: "monthly_prepaid",
        },
      });
      expect(rateResponse.status).toBe(200);
      const rate = yield* resJson(rateResponse);

      const invalidMonth = yield* reqEffect("POST", path, {
        cookie: adminCookie,
        body: {
          billing_month: "2026-08-02",
          amount_cents: 18000,
          paid_at: "2026-07-28T15:00:00.000Z",
        },
      });
      expect(invalidMonth.status).toBe(400);

      const noSchedule = yield* reqEffect("POST", path, {
        cookie: adminCookie,
        body: {
          billing_month: "2026-08-01",
          amount_cents: 18000,
          paid_at: "2026-07-28T15:00:00.000Z",
        },
      });
      expect(noSchedule.status).toBe(409);

      const scheduleResponse = yield* reqEffect(
        "POST",
        `/api/admin/students/${studentId}/recurring-schedules`,
        {
          cookie: adminCookie,
          body: {
            student_rate_id: rate.id,
            day_of_week: 2,
            local_start_time: "16:30",
            timezone: "America/Chicago",
            starts_on: "2026-08-01",
            ends_on: null,
            active: true,
          },
        },
      );
      expect(scheduleResponse.status).toBe(200);
      const schedule = yield* resJson(scheduleResponse);

      const monthStatus = (month: string) =>
        reqEffect("GET", `/api/admin/monthly-payments?month=${month}`, {
          cookie: adminCookie,
        }).pipe(
          Effect.flatMap(resJson),
          Effect.map((rows: MonthlyPaymentStatus[]) =>
            rows.find((row) => row.student_id === studentId),
          ),
        );
      expect((yield* monthStatus("2026-08-01"))?.payment).toBeNull();
      expect(yield* monthStatus("2026-07-01")).toBeUndefined();
      expect(
        (yield* reqEffect("GET", "/api/admin/monthly-payments?month=2026-08-02", {
          cookie: adminCookie,
        })).status,
      ).toBe(400);

      const paymentBody = {
        billing_month: "2026-08-01",
        amount_cents: 18000,
        paid_at: "2026-07-28T15:00:00.000Z",
        notes: "August prepaid lessons",
      };
      const firstResponse = yield* reqEffect("POST", path, {
        cookie: adminCookie,
        body: paymentBody,
      });
      expect(firstResponse.status).toBe(200);
      const first = yield* resJson(firstResponse);
      expect(first.generation_status).toBe("pending");
      expect((yield* monthStatus("2026-08-01"))?.payment?.id).toBe(first.id);

      const secondResponse = yield* reqEffect("POST", path, {
        cookie: adminCookie,
        body: paymentBody,
      });
      expect(secondResponse.status).toBe(200);
      const second = yield* resJson(secondResponse);
      expect(second.id).toBe(first.id);

      const paymentsResponse = yield* reqEffect("GET", path, { cookie: adminCookie });
      expect(paymentsResponse.status).toBe(200);
      const payments = yield* resJson(paymentsResponse);
      expect(
        payments.filter(
          (payment: { billing_month: string }) => payment.billing_month === "2026-08-01",
        ),
      ).toHaveLength(1);

      const jobs = yield* Effect.tryPromise(() =>
        testDb.query(
          `select jobs.id, jobs.payload
             from graphile_worker._private_jobs jobs
             join graphile_worker._private_tasks tasks on tasks.id = jobs.task_id
             where tasks.identifier = 'lessons__generate_prepaid_period'
               and jobs.payload ->> 'studentId' = $1
               and jobs.payload ->> 'billingMonth' = $2`,
          [first.student_id, "2026-08-01"],
        ),
      );
      expect(jobs.rows).toHaveLength(1);
      expect(jobs.rows[0].payload).toEqual({
        studentId: first.student_id,
        billingMonth: "2026-08-01",
      });

      const workerLogger = new Logger(consoleLogFactory, { label: "test" });
      const poolClient = Object.assign(testDb, { release: () => undefined }) as any;
      const workerHelpers = {
        withPgClient: async (callback: (client: typeof poolClient) => Promise<unknown>) =>
          callback(poolClient),
        logger: workerLogger,
      } as any;
      yield* Effect.promise(() =>
        Promise.resolve(
          generatePrepaidPeriodTask(
            { studentId: first.student_id, billingMonth: "2026-08-01" },
            workerHelpers,
          ),
        ),
      );

      const generated = yield* Effect.tryPromise(() =>
        testDb.query(
          `select id, recurrence_date, scheduled_at, recurring_schedule_id
             from app_public.lessons
            where recurring_schedule_id = $1
            order by recurrence_date`,
          [schedule.id],
        ),
      );
      expect(generated.rows).toHaveLength(4);

      yield* Effect.promise(() =>
        Promise.resolve(
          generatePrepaidPeriodTask(
            { studentId: first.student_id, billingMonth: "2026-08-01" },
            workerHelpers,
          ),
        ),
      );
      const generatedAgain = yield* Effect.tryPromise(() =>
        testDb.query(
          `select count(*)::integer as count
             from app_public.lessons
            where recurring_schedule_id = $1`,
          [generated.rows[0].recurring_schedule_id],
        ),
      );
      expect(generatedAgain.rows[0].count).toBe(4);

      const paymentState = yield* Effect.tryPromise(() =>
        testDb.query(
          `select generation_status, generated_at
             from app_public.monthly_payments
            where id = $1`,
          [first.id],
        ),
      );
      expect(paymentState.rows[0].generation_status).toBe("generated");
      expect(paymentState.rows[0].generated_at).not.toBeNull();
    }),
  );

  it.effect(
    "authorization: access control",
    Effect.fnUntraced(function* () {
      const unauth = yield* reqEffect("GET", "/api/courses");
      expect(unauth.status).toBe(401);

      const studentAdmin = yield* reqEffect("GET", "/api/admin/courses", { cookie: studentCookie });
      expect(studentAdmin.status).toBe(403);

      const meNoAuth = yield* reqEffect("GET", "/api/me");
      expect(meNoAuth.status).toBe(200);
      expect((yield* resJson(meNoAuth)).user).toBeNull();
    }),
  );

  it.effect(
    "recurring schedules require an admin and a monthly prepaid rate",
    Effect.fnUntraced(function* () {
      const path = `/api/admin/students/${studentId}/recurring-schedules`;
      expect((yield* reqEffect("GET", path)).status).toBe(401);
      expect((yield* reqEffect("GET", path, { cookie: studentCookie })).status).toBe(403);

      const singleRateResponse = yield* reqEffect("POST", "/api/admin/student-rates", {
        cookie: adminCookie,
        body: {
          student_id: studentId,
          rate_cents: 12000,
          lesson_duration_minutes: 60,
          location_type: "studio",
          billing_model: "single_booking",
        },
      });
      expect(singleRateResponse.status).toBe(200);
      const singleRate = yield* resJson(singleRateResponse);
      const scheduleBody = {
        student_rate_id: singleRate.id,
        day_of_week: 2,
        local_start_time: "16:30",
        timezone: "America/Chicago",
        starts_on: "2026-07-01",
        active: true,
      };
      expect(
        (yield* reqEffect("POST", path, { cookie: adminCookie, body: scheduleBody })).status,
      ).toBe(409);

      // The student has no family, so they pay for their own booking.
      const bookingResponse = yield* reqEffect("POST", "/api/my-lessons/book", {
        cookie: studentCookie,
        body: {
          scheduled_at: "2027-01-12T22:30:00.000Z",
          duration_minutes: 60,
          location_type: "studio",
        },
      });
      expect(bookingResponse.status).toBe(200);
      const booking = yield* resJson(bookingResponse);
      const obligation = yield* Effect.tryPromise(() =>
        testDb.query(
          `select b.payer_id, b.status, b.total_cents, bli.line_type, d.amount_cents, d.status as deposit_status
             from app_public.bill_line_items bli
             join app_public.bills b on b.id = bli.bill_id
             join app_public.lesson_deposits d on d.lesson_id = bli.lesson_id
            where bli.lesson_id = $1`,
          [booking.id],
        ),
      );
      expect(obligation.rows).toEqual([
        {
          payer_id: studentId,
          status: "issued",
          total_cents: 12000,
          line_type: "single_booking",
          amount_cents: 4000,
          deposit_status: "held",
        },
      ]);
    }),
  );

  it.effect(
    "admin-scheduled single-booking lessons are billed, and cancel or delete cancels the bill",
    Effect.fnUntraced(function* () {
      const created = yield* Effect.tryPromise(() =>
        testDb.query(
          `select id from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
          ["admin_booked", "Admin Booked", "admin_booked@test.com", "password123"],
        ),
      );
      const bookedStudentId: string = created.rows[0].id;
      for (const rate of [
        { location_type: "studio", rate_cents: 9000, billing_model: "single_booking" },
        { location_type: "online", rate_cents: 8000, billing_model: "monthly_prepaid" },
      ]) {
        const response = yield* reqEffect("POST", "/api/admin/student-rates", {
          cookie: adminCookie,
          body: { student_id: bookedStudentId, lesson_duration_minutes: 60, ...rate },
        });
        expect(response.status).toBe(200);
      }

      const schedule = Effect.fnUntraced(function* (scheduledAt: string, locationType: string) {
        const response = yield* reqEffect("POST", "/api/admin/lessons", {
          cookie: adminCookie,
          body: {
            student_id: bookedStudentId,
            scheduled_at: scheduledAt,
            duration_minutes: 60,
            location_type: locationType,
          },
        });
        expect(response.status).toBe(200);
        const lesson: { id: string } = yield* resJson(response);
        return lesson.id;
      });
      const billFor = (lessonId: string) =>
        Effect.tryPromise(() =>
          testDb.query(
            `select b.payer_id, b.status, b.total_cents,
                    (select count(*)::int from app_public.lesson_deposits d where d.lesson_id = $1) as deposits
               from app_public.bill_line_items bli
               join app_public.bills b on b.id = bli.bill_id
              where bli.lesson_id = $1`,
            [lessonId],
          ),
        ).pipe(Effect.map((result) => result.rows));

      const cancelled = yield* schedule("2027-02-02T22:00:00.000Z", "studio");
      const deleted = yield* schedule("2027-02-09T22:00:00.000Z", "studio");
      const prepaid = yield* schedule("2027-02-16T22:00:00.000Z", "online");

      expect(yield* billFor(cancelled)).toEqual([
        { payer_id: bookedStudentId, status: "issued", total_cents: 9000, deposits: 0 },
      ]);
      expect(yield* billFor(prepaid)).toEqual([]);

      const cancel = yield* reqEffect("POST", `/api/admin/lessons/${cancelled}/cancel`, {
        cookie: adminCookie,
        body: {},
      });
      expect(cancel.status).toBe(200);
      expect((yield* billFor(cancelled))[0].status).toBe("cancelled");

      const deletedBill = yield* Effect.tryPromise(() =>
        testDb.query(`select bill_id from app_public.bill_line_items where lesson_id = $1`, [
          deleted,
        ]),
      );
      const remove = yield* reqEffect("DELETE", `/api/admin/lessons/${deleted}`, {
        cookie: adminCookie,
      });
      expect(remove.status).toBe(200);
      const afterDelete = yield* Effect.tryPromise(() =>
        testDb.query(`select status from app_public.bills where id = $1`, [
          deletedBill.rows[0].bill_id,
        ]),
      );
      expect(afterDelete.rows).toEqual([{ status: "cancelled" }]);
    }),
  );

  it.effect(
    "effective-student: parent acts as selected child for writes and reads",
    Effect.fnUntraced(function* () {
      const parentResult = yield* Effect.tryPromise(() =>
        testDb.query(
          `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
          ["parent1", "Test Parent", "parent1@test.com", "parent123"],
        ),
      );
      const parentId = parentResult.rows[0].id;
      yield* Effect.tryPromise(() =>
        testDb.query(`update app_public.users set role = 'parent' where id = $1`, [parentId]),
      );
      const parentPrimaryEmail = "parent1.preferred@test.com";
      yield* Effect.tryPromise(() =>
        testDb.query(`update app_public.user_emails set is_primary = false where user_id = $1`, [
          parentId,
        ]),
      );
      yield* Effect.tryPromise(() =>
        testDb.query(
          `insert into app_public.user_emails (user_id, email, is_verified, is_primary) values ($1, $2::citext, true, true), ($1, $3::citext, true, false)`,
          [parentId, parentPrimaryEmail, "parent1.secondary@test.com"],
        ),
      );

      const childResult = yield* Effect.tryPromise(() =>
        testDb.query(
          `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
          ["child1", "Test Child", "child1@test.com", "child123"],
        ),
      );
      const childId = childResult.rows[0].id;
      yield* Effect.tryPromise(() =>
        testDb.query(`update app_public.users set role = 'student' where id = $1`, [childId]),
      );

      const familyResult = yield* Effect.tryPromise(() =>
        testDb.query(`insert into app_public.families (slug, name) values ($1, $2) returning id`, [
          "test-family",
          "Test Family",
        ]),
      );
      const familyId = familyResult.rows[0].id;

      yield* Effect.tryPromise(() =>
        testDb.query(
          `insert into app_public.family_memberships (family_id, user_id, is_owner) values ($1, $2, true), ($1, $3, false)`,
          [familyId, parentId, childId],
        ),
      );

      const parentLoginRes = yield* reqEffect("POST", "/api/login", {
        body: { id: "parent1", password: "parent123" },
      });
      expect(parentLoginRes.status).toBe(200);
      const parentCookie = getCookie(parentLoginRes)!;
      expect(parentCookie).toBeTruthy();

      const setActive = yield* reqEffect("POST", "/api/switch-active-student", {
        body: { student_id: childId },
        cookie: parentCookie,
      });
      expect(setActive.status).toBe(200);

      const meRes = yield* reqEffect("GET", "/api/me", { cookie: parentCookie });
      expect(meRes.status).toBe(200);
      const me = yield* resJson(meRes);
      expect(me.isParent).toBe(true);
      expect(me.activeStudentId).toBe(childId);
      expect(me.familyStudents.length).toBeGreaterThanOrEqual(1);
      expect(me.user.email).toBe(parentPrimaryEmail);

      const sessionResult = yield* Effect.tryPromise(() =>
        testDb.query("select id from app_private.sessions where cookie_id = $1", [
          cookieIdFromToken(parentCookie),
        ]),
      );
      const [{ serverRuntime }, { AuthRouteService }] = yield* Effect.promise(() =>
        Promise.all([import("../runtime.js"), import("../services/authRouteService.js")]),
      );
      const directMe = yield* Effect.promise(() =>
        serverRuntime.runPromise(
          AuthRouteService.use((authRouteService) =>
            authRouteService.me(sessionResult.rows[0].id, parentId, childId),
          ),
        ),
      );
      expect(me).toEqual(directMe);

      const notationTracks = [{ index: 0, name: "Piano", short_name: "Pno", is_percussion: false }];
      const material = yield* Effect.tryPromise(() =>
        testDb.query(
          `insert into app_public.materials (title, original_filename, storage_key, mime_type, file_size, is_global, notation_tracks) values ($1, $2, $3, $4, $5, $6, $7::jsonb) returning id`,
          [
            "Twinkle Twinkle",
            "twinkle.gp5",
            "/data/twinkle.gp5",
            "application/octet-stream",
            2048,
            false,
            JSON.stringify(notationTracks),
          ],
        ),
      );

      yield* Effect.tryPromise(() =>
        testDb.query(
          `insert into app_public.student_materials (student_id, material_id) values ($1, $2)`,
          [childId, (material.rows[0] as any).id],
        ),
      );

      const materialId = (material.rows[0] as any).id;

      const practiceLog = yield* reqEffect("POST", "/api/practice-logs", {
        body: { material_id: materialId, status: "practiced", notes: "Good session" },
        cookie: parentCookie,
      });
      expect(practiceLog.status).toBe(200);
      const log = yield* resJson(practiceLog);
      expect(log.student_id).toBe(childId);
      expect(log.material_id).toBe(materialId);

      const playback = yield* reqEffect("POST", `/api/assignments/${materialId}/playback`, {
        body: { seconds: 42 },
        cookie: parentCookie,
      });
      expect(playback.status).toBe(200);
      const pb = yield* resJson(playback);
      expect(pb.material_id).toBe(materialId);
      expect(pb.listened_seconds).toBe(42);

      const review = yield* reqEffect("POST", `/api/assignments/${materialId}/reviews`, {
        body: { stars: 3 },
        cookie: parentCookie,
      });
      expect(review.status).toBe(200);
      const rev = yield* resJson(review);
      expect(rev.material_id).toBe(materialId);
      expect(rev.stars).toBe(3);

      const noteRes = yield* reqEffect("PUT", `/api/assignments/${materialId}/notes`, {
        body: { body: "Need more work on section B" },
        cookie: parentCookie,
      });
      expect(noteRes.status).toBe(200);
      const note = yield* resJson(noteRes);
      expect(note.student_id).toBe(childId);
      expect(note.material_id).toBe(materialId);
      expect(note.body).toBe("Need more work on section B");

      const msgRes = yield* reqEffect("POST", "/api/messages", {
        body: { body: "Hello from parent acting as child" },
        cookie: parentCookie,
      });
      expect(msgRes.status).toBe(200);
      const msg = yield* resJson(msgRes);
      expect(msg.sender_id).toBe(childId);
      expect(msg.body).toBe("Hello from parent acting as child");

      const assignRes = yield* reqEffect("GET", "/api/assignments", { cookie: parentCookie });
      expect(assignRes.status).toBe(200);
      const assignList = yield* resJson(assignRes);
      expect(assignList.length).toBeGreaterThanOrEqual(1);
      const assigned = assignList.find((m: any) => m.id === materialId);
      expect(assigned).toBeTruthy();

      const notesGet = yield* reqEffect("GET", `/api/assignments/${materialId}/notes`, {
        cookie: parentCookie,
      });
      expect(notesGet.status).toBe(200);
      const notesBody = yield* resJson(notesGet);
      expect(notesBody.student_id).toBe(childId);

      const msgs = yield* reqEffect("GET", "/api/messages", { cookie: parentCookie });
      expect(msgs.status).toBe(200);
      const msgList = yield* resJson(msgs);
      expect(msgList.some((m: any) => m.sender_id === childId)).toBe(true);

      yield* Effect.tryPromise(() =>
        testDb.query("delete from app_public.student_materials where material_id = $1", [
          materialId,
        ]),
      );
      yield* Effect.tryPromise(() =>
        testDb.query("delete from app_public.materials where id = $1", [materialId]),
      );
      yield* Effect.tryPromise(() =>
        testDb.query("delete from app_public.family_memberships where family_id = $1", [familyId]),
      );
      yield* Effect.tryPromise(() =>
        testDb.query("delete from app_public.families where id = $1", [familyId]),
      );
      yield* Effect.tryPromise(() =>
        testDb.query("delete from app_private.sessions where user_id = $1", [parentId]),
      );
      yield* Effect.tryPromise(() =>
        testDb.query("delete from app_private.sessions where user_id = $1", [childId]),
      );
      yield* Effect.tryPromise(() =>
        testDb.query("delete from app_public.users where id = $1", [childId]),
      );
      yield* Effect.tryPromise(() =>
        testDb.query("delete from app_public.users where id = $1", [parentId]),
      );
    }),
  );
  it.live(
    "delivers a change to the signed-in user it concerns over /api/events",
    () =>
      Effect.gen(function* () {
        const { handleApiRequest } = yield* Effect.promise(() => import("../app.js"));
        const res = yield* Effect.promise(() =>
          handleApiRequest(
            new Request(`${TEST_ROOT_URL}/api/events`, {
              headers: { Cookie: `session=${studentCookie}` },
            }),
          ),
        );
        expect(res.status).toBe(200);
        const body = res.body;
        if (body === null) return yield* Effect.die("the events response has no body");

        const firstMessage = Stream.fromReadableStream({
          evaluate: () => body,
          onError: (cause) => cause,
        }).pipe(
          Stream.decodeText,
          Stream.filter((chunk) => chunk.startsWith("data: ")),
          Stream.runHead,
        );
        // The stream subscribes when it is first read, so the change is written until one arrives.
        const writeChange = Effect.promise(() =>
          testDb.query(
            `insert into app_private.realtime_events (topic, event, subject) values ('rt:messages', 'insert', $1)`,
            [studentId],
          ),
        ).pipe(Effect.repeat(Schedule.spaced("200 millis")));

        const message = yield* Effect.raceFirst(
          firstMessage,
          writeChange.pipe(Effect.andThen(Effect.never)),
        ).pipe(Effect.timeout("10 seconds"));
        expect(message).toStrictEqual(
          Option.some(
            `data: ${JSON.stringify({ event: "insert", subject: studentId, queryKeys: [["messages"]] })}\n\n`,
          ),
        );
      }),
    30_000,
  );

  it.effect(
    "serves family billing only to the family that pays it",
    () =>
      Effect.gen(function* () {
        const query = (text: string, values: ReadonlyArray<unknown>) =>
          Effect.promise(() => testDb.query(text, [...values]));
        const makeUser = Effect.fn(function* (username: string, role: string) {
          const created = yield* query(
            `select id from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
            [username, username, `${username}@test.com`, `${username}123`],
          );
          const id: string = created.rows[0].id;
          yield* query(`update app_public.users set role = $1 where id = $2`, [role, id]);
          const login = yield* reqEffect("POST", "/api/login", {
            body: { id: username, password: `${username}123` },
          });
          return { id, cookie: getCookie(login) ?? "" };
        });
        const makeFamily = Effect.fn(function* (slug: string, payerId: string) {
          const family = yield* query(
            `insert into app_public.families (slug, name) values ($1, $2) returning id`,
            [slug, slug],
          );
          yield* query(
            `insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact) values ($1, $2, true, true)`,
            [family.rows[0].id, payerId],
          );
        });

        const payer = yield* makeUser("fam_http_payer", "parent");
        const otherPayer = yield* makeUser("fam_http_other", "parent");
        const teacher = yield* makeUser("fam_http_teacher", "teacher");
        yield* makeFamily("fam-http-payer", payer.id);
        yield* makeFamily("fam-http-other", otherPayer.id);
        const bill = yield* query(
          `insert into app_public.bills (payer_id, bill_number, billing_period_start, billing_period_end, due_date, subtotal_cents, discount_cents, tax_cents, total_cents, status)
           values ($1, app_public.next_bill_number(), '2026-07-01', '2026-07-31', '2026-07-15', 5000, 0, 0, 5000, 'draft') returning id`,
          [payer.id],
        );
        const billId: string = bill.rows[0].id;
        yield* query(
          `update app_public.bills set status = 'issued', issued_at = now() where id = $1`,
          [billId],
        );
        const payment = yield* query(
          `insert into app_public.payments (payer_id, payment_number, amount_cents, method, received_at)
           values ($1, app_public.next_payment_number(), 5000, 'check', now()) returning id`,
          [payer.id],
        );
        const paymentId: string = payment.rows[0].id;

        const lists = [
          "/api/family/billing",
          "/api/family/billing/bills",
          "/api/family/billing/payments",
          "/api/family/billing/credits",
        ];
        const records = [
          `/api/family/billing/bills/${billId}`,
          `/api/family/billing/bills/${billId}/pdf`,
          `/api/family/billing/payments/${paymentId}`,
          `/api/family/billing/payments/${paymentId}/receipt`,
        ];
        const statuses = (paths: ReadonlyArray<string>, cookie?: string) =>
          Effect.forEach(paths, (path) =>
            reqEffect("GET", path, { cookie }).pipe(Effect.map((res) => [path, res.status])),
          );
        const all = [...lists, ...records];

        expect(yield* statuses(all)).toEqual(all.map((path) => [path, 401]));
        expect(yield* statuses(all, teacher.cookie)).toEqual(all.map((path) => [path, 403]));
        expect(yield* statuses(records, otherPayer.cookie)).toEqual(
          records.map((path) => [path, 404]),
        );
        const otherBills = yield* reqEffect("GET", "/api/family/billing/bills", {
          cookie: otherPayer.cookie,
        }).pipe(Effect.flatMap(resJson));
        expect(otherBills).toEqual([]);

        // The payer reads every one of the same URLs, so the refusals above come from access rules.
        expect(yield* statuses(all, payer.cookie)).toEqual(all.map((path) => [path, 200]));
        const payerBills = yield* reqEffect("GET", "/api/family/billing/bills", {
          cookie: payer.cookie,
        }).pipe(Effect.flatMap(resJson));
        expect(payerBills.map((row: { id: string }) => row.id)).toEqual([billId]);
      }),
    60_000,
  );
});
