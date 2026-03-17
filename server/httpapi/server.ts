import { HttpApiBuilder, HttpServerRequest } from "@effect/platform";
import { Effect, Layer } from "effect";
import { SqlError } from "@effect/sql";

/** Convert SqlError to defect while preserving business errors (NotFound, BadRequest, etc.) */
const sqlOrDie = <A, E, R>(self: Effect.Effect<A, E | SqlError.SqlError, R>): Effect.Effect<A, E, R> =>
  self.pipe(Effect.catchTag("SqlError", (e) => Effect.die(e)));

import {
  DfgPortalApi,
  NotFound,
  BadRequest,
  Conflict,
  Locked,
} from "../../shared/contract.js";
import {
  CurrentSession,
  CurrentUser,
  CurrentAdmin,
  SessionMiddlewareLive,
  AuthMiddlewareLive,
  AdminMiddlewareLive,
  setSessionCookie,
  expireSessionCookie,
} from "../services/sessionMiddleware.js";
import { AuthService } from "../services/authService.js";
import { SessionService } from "../services/sessionService.js";
import { EmailService } from "../services/emailService.js";
import { PgRootDB, PgAuthDB, withAuthContext } from "../db.js";
import { RateLimiter } from "../services/rateLimiter.js";
import { OAuthConfig, OAuthConfigLive } from "../services/oauthService.js";
import { env } from "../assertEnv.js";
import { sql } from "kysely";
import { decodeJwt } from "jose";
import type { UserRole } from "../../shared/schemas.js";

const rateLimit = (key: string, max: number, windowMs: number) =>
  Effect.gen(function* () {
    const limiter = yield* RateLimiter;
    yield* limiter.check(key, { max, windowMs }).pipe(
      Effect.catchTag("RateLimitExceeded", () =>
        Effect.die(new Error("Too many requests")),
      ),
    );
  });

// === Helpers ===

type UserRow = {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
};

/** Create session + set cookie for a user row. Returns UserResponse shape. */
const sessionFromUser = (user: UserRow) =>
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const { token, expiresAt } = yield* sessionService.createSession(user.id).pipe(Effect.orDie);
    yield* setSessionCookie(token, expiresAt);
    return {
      id: user.id,
      username: user.username,
      name: user.name ?? "",
      email: user.email,
      role: user.role as UserRole,
    };
  });

// === Public ===

const publicLive = HttpApiBuilder.group(DfgPortalApi, "public", (handlers) =>
  handlers
    .handle("health", () => Effect.succeed({ success: true as const }))
    .handle("contact", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!request.headers["x-requested-with"])
          return yield* new BadRequest({ error: "Missing CSRF header" });
        if (payload.website)
          return yield* new BadRequest({ error: "Invalid submission" });
        const ip = request.headers["x-forwarded-for"] ?? "unknown";
        yield* rateLimit(`contact:${ip}`, 5, 60_000);

        const db = yield* PgRootDB;
        yield* db.insertInto("app_public.contact_submissions").values({
          name: payload.name,
          email: payload.email,
          phone: payload.phone ?? null,
          instrument: payload.instrument,
          format: payload.format,
          message: payload.message ?? "",
        }).pipe(Effect.orDie);

        yield* EmailService.send({
          to: env.ADMIN_EMAIL,
          subject: `New contact: ${payload.name} (${payload.instrument})`,
          html: `<p><strong>${payload.name}</strong> (${payload.email}) submitted a contact form.</p>
            <p>Instrument: ${payload.instrument} | Format: ${payload.format}</p>
            <p>${payload.message ?? ""}</p>`,
        }).pipe(Effect.orDie);

        return { success: true as const };
      }),
    )
    .handle("googleOAuthStart", () =>
      Effect.gen(function* () {
        const config = yield* OAuthConfig;
        const { clientId, redirectUri } = config.google;
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "openid email profile",
          access_type: "offline",
        });
        return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
      }),
    )
    .handle("googleOAuthCallback", ({ urlParams }) =>
      Effect.gen(function* () {
        const config = yield* OAuthConfig;
        const { clientId, clientSecret, redirectUri } = config.google;

        // Exchange code for tokens
        const tokenRes: unknown = yield* Effect.tryPromise({
          try: () =>
            fetch("https://oauth2.googleapis.com/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                code: urlParams.code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
              }),
            }).then((r) => r.json()),
          catch: () => new BadRequest({ error: "Token exchange failed" }),
        });

        const tokenData = tokenRes as Record<string, unknown>;
        if (typeof tokenData.access_token !== "string") {
          return yield* new BadRequest({ error: "Token exchange failed" });
        }

        // Fetch user info
        const userInfoRes: unknown = yield* Effect.tryPromise({
          try: () =>
            fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${tokenData.access_token}` },
            }).then((r) => r.json()),
          catch: () => new BadRequest({ error: "Failed to fetch user info" }),
        });

        const userInfo = userInfoRes as Record<string, unknown>;
        if (typeof userInfo.sub !== "string") {
          return yield* new BadRequest({ error: "Failed to fetch user info" });
        }

        // Link or register via DB function
        const db = yield* PgRootDB;
        const user = yield* db
          .selectFrom(
            sql<UserRow>`app_private.link_or_register_user(
              'google',
              ${userInfo.sub},
              ${JSON.stringify(userInfo)}::jsonb,
              ${JSON.stringify(tokenData)}::jsonb
            )`.as("u"),
          )
          .selectAll()
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementException", () =>
              Effect.fail(new BadRequest({ error: "OAuth registration failed" })),
            ),
            sqlOrDie,
          );

        return yield* sessionFromUser(user);
      }),
    )
    .handle("appleOAuthStart", () =>
      Effect.gen(function* () {
        const config = yield* OAuthConfig;
        const { clientId, redirectUri } = config.apple;
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code id_token",
          scope: "name email",
          response_mode: "form_post",
        });
        return { url: `https://appleid.apple.com/auth/authorize?${params}` };
      }),
    )
    .handle("appleOAuthCallback", ({ payload }) =>
      Effect.gen(function* () {
        const config = yield* OAuthConfig;
        const { clientId, redirectUri } = config.apple;

        // Exchange code for tokens
        const tokenRes: unknown = yield* Effect.tryPromise({
          try: () =>
            fetch("https://appleid.apple.com/auth/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                code: payload.code,
                client_id: clientId,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
              }),
            }).then((r) => r.json()),
          catch: () => new BadRequest({ error: "Apple token exchange failed" }),
        });

        const tokenData = tokenRes as Record<string, unknown>;

        // Decode the id_token JWT (from Apple's response or the POST payload)
        const idToken = (typeof tokenData.id_token === "string" ? tokenData.id_token : payload.id_token) ?? "";
        if (!idToken) {
          return yield* new BadRequest({ error: "No id_token received from Apple" });
        }

        const claims = decodeJwt(idToken);
        const sub = claims.sub;
        const email = typeof claims.email === "string" ? claims.email : undefined;

        if (!sub) {
          return yield* new BadRequest({ error: "Invalid Apple id_token" });
        }

        const profile = { sub, email };

        const db = yield* PgRootDB;
        const user = yield* db
          .selectFrom(
            sql<UserRow>`app_private.link_or_register_user(
              'apple',
              ${sub},
              ${JSON.stringify(profile)}::jsonb,
              ${JSON.stringify(tokenData)}::jsonb
            )`.as("u"),
          )
          .selectAll()
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementException", () =>
              Effect.fail(new BadRequest({ error: "OAuth registration failed" })),
            ),
            sqlOrDie,
          );

        return yield* sessionFromUser(user);
      }),
    ),
);

// === Auth ===

const authLive = HttpApiBuilder.group(DfgPortalApi, "auth", (handlers) =>
  handlers
    .handle("login", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!request.headers["x-requested-with"])
          return yield* new BadRequest({ error: "Missing CSRF header" });
        const ip = request.headers["x-forwarded-for"] ?? "unknown";
        yield* rateLimit(`login:${ip}`, 10, 60_000);
        const result = yield* AuthService.login(payload).pipe(
          Effect.catchTag("AccountLockedError", (e) =>
            Effect.fail(new Locked({ error: e.message })),
          ),
          Effect.catchTag("InvalidCredentials", (e) =>
            Effect.fail(new BadRequest({ error: e.message })),
          ),
          Effect.orDie,
        );
        yield* setSessionCookie(result.token, result.expiresAt);
        return {
          id: result.user.id,
          username: result.user.username,
          name: result.user.name ?? "",
          email: result.user.email,
          role: result.user.role as UserRole,
        };
      }),
    )
    .handle("requestMagicLink", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!request.headers["x-requested-with"])
          return yield* Effect.die(new Error("Missing CSRF header"));
        const ip = request.headers["x-forwarded-for"] ?? "unknown";
        yield* rateLimit(`magic-link:${ip}`, 5, 60_000);

        const db = yield* PgRootDB;
        yield* db
          .selectNoFrom([
            sql`app_private.generate_magic_link(${payload.email}::citext)`.as("_"),
          ])
          .pipe(Effect.orDie);
        return { success: true as const };
      }),
    )
    .handle("verifyMagicLink", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!request.headers["x-requested-with"])
          return yield* new BadRequest({ error: "Missing CSRF header" });

        const db = yield* PgRootDB;
        const user = yield* db
          .selectFrom(
            sql<UserRow>`app_private.verify_magic_link(${payload.token})`.as("u"),
          )
          .selectAll()
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementException", () =>
              Effect.fail(new BadRequest({ error: "Invalid or expired magic link" })),
            ),
            sqlOrDie,
          );

        return yield* sessionFromUser(user);
      }),
    )
    .handle("logout", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!request.headers["x-requested-with"])
          return yield* Effect.die(new Error("Missing CSRF header"));
        const { session } = yield* CurrentSession;
        yield* AuthService.logout(session?.cookie_id).pipe(Effect.orDie);
        yield* expireSessionCookie;
        return { success: true as const };
      }),
    )
    .handle("setPassword", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!request.headers["x-requested-with"])
          return yield* new BadRequest({ error: "Missing CSRF header" });
        const result = yield* AuthService.setPassword(payload).pipe(
          Effect.catchTag("InvalidToken", (e) =>
            Effect.fail(new BadRequest({ error: e.message })),
          ),
          Effect.orDie,
        );
        yield* setSessionCookie(result.token, result.expiresAt);
        return { success: true as const };
      }),
    )
    .handle("forgotPassword", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!request.headers["x-requested-with"])
          return yield* Effect.die(new Error("Missing CSRF header"));
        yield* AuthService.forgotPassword(payload).pipe(Effect.orDie);
        return { success: true as const };
      }),
    )
    .handle("resetPassword", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!request.headers["x-requested-with"])
          return yield* new BadRequest({ error: "Missing CSRF header" });
        const result = yield* AuthService.resetPassword(payload).pipe(
          Effect.catchTag("InvalidToken", (e) =>
            Effect.fail(new BadRequest({ error: e.message })),
          ),
          Effect.orDie,
        );
        yield* setSessionCookie(result.token, result.expiresAt);
        return { success: true as const };
      }),
    )
    .handle("me", () =>
      Effect.gen(function* () {
        const { user } = yield* CurrentSession;
        if (!user) return { user: null };
        const db = yield* PgRootDB;
        const profile = yield* db
          .selectFrom("app_public.users")
          .select(["id", "username", "name", "email", "role"])
          .where("id", "=", user.id)
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementException", () =>
              Effect.succeed(null),
            ),
            Effect.orDie,
          );
        return { user: profile };
      }),
    ),
);

// === Authenticated ===

const authenticatedLive = HttpApiBuilder.group(
  DfgPortalApi,
  "authenticated",
  (handlers) =>
    handlers
      .handle("courses", () =>
        Effect.gen(function* () {
          const { user } = yield* CurrentUser;
          const db = yield* PgAuthDB;
          return yield* withAuthContext(db, user.id, user.role,
            db.selectFrom("app_public.courses")
              .select(["id", "title", "description", "instrument"])
              .pipe(Effect.orDie),
          ).pipe(Effect.orDie);
        }),
      )
      .handle("courseDetail", ({ path }) =>
        Effect.gen(function* () {
          const { user } = yield* CurrentUser;
          const db = yield* PgAuthDB;
          return yield* withAuthContext(db, user.id, user.role,
            Effect.gen(function* () {
              const course = yield* db
                .selectFrom("app_public.courses")
                .select(["id", "title", "description", "instrument"])
                .where("id", "=", path.id)
                .pipe(
                  Effect.head,
                  Effect.catchTag("NoSuchElementException", () =>
                    Effect.fail(new NotFound({ error: "Course not found" })),
                  ),
                  sqlOrDie,
                );

              const modules = yield* db
                .selectFrom("app_public.modules")
                .select(["id", "course_id", "title", "description", "sort_order"])
                .where("course_id", "=", path.id)
                .orderBy("sort_order")
                .pipe(Effect.orDie);

              const modulesWithMaterials = yield* Effect.forEach(modules, (mod) =>
                db
                  .selectFrom("app_public.module_materials as mm")
                  .innerJoin(
                    "app_public.materials as mat",
                    "mat.id",
                    "mm.material_id",
                  )
                  .where("mm.module_id", "=", mod.id)
                  .select([
                    "mat.id",
                    "mat.title",
                    "mat.original_filename",
                    "mat.mime_type",
                    "mat.file_size",
                    "mat.is_global",
                  ])
                  .orderBy("mm.sort_order")
                  .pipe(Effect.map((materials) => ({ ...mod, materials })), Effect.orDie),
              );

              return { ...course, modules: modulesWithMaterials };
            }),
          ).pipe(sqlOrDie);
        }),
      )
      .handle("library", ({ urlParams }) =>
        Effect.gen(function* () {
          const { user } = yield* CurrentUser;
          const db = yield* PgAuthDB;
          return yield* withAuthContext(db, user.id, user.role,
            db.selectFrom("app_public.materials")
              .select([
                "id",
                "title",
                "original_filename",
                "mime_type",
                "file_size",
                "is_global",
              ])
              .limit(urlParams.limit ?? 50)
              .offset(urlParams.offset ?? 0)
              .pipe(Effect.orDie),
          ).pipe(Effect.orDie);
        }),
      )
      .handle("assignments", () =>
        Effect.gen(function* () {
          const { user } = yield* CurrentUser;
          const db = yield* PgAuthDB;
          return yield* withAuthContext(db, user.id, user.role,
            db.selectFrom("app_public.student_materials as sm")
              .innerJoin("app_public.materials as m", "m.id", "sm.material_id")
              .select([
                "m.id",
                "m.title",
                "m.original_filename",
                "m.mime_type",
                "m.file_size",
                "m.is_global",
              ])
              .pipe(Effect.orDie),
          ).pipe(Effect.orDie);
        }),
      )
      // Practice logs
      .handle("practiceLogs", ({ urlParams }) =>
        Effect.gen(function* () {
          const { user } = yield* CurrentUser;
          const db = yield* PgAuthDB;
          return yield* withAuthContext(db, user.id, user.role,
            Effect.gen(function* () {
              let query = db
                .selectFrom("app_public.practice_logs")
                .selectAll()
                .orderBy("logged_at", "desc");
              if (urlParams.material_id) {
                query = query.where("material_id", "=", urlParams.material_id);
              }
              return yield* query.pipe(
                Effect.map((rows) =>
                  rows.map((r) => ({ ...r, logged_at: r.logged_at.toISOString() })),
                ),
                Effect.orDie,
              );
            }),
          ).pipe(Effect.orDie);
        }),
      )
      .handle("logPractice", ({ payload }) =>
        Effect.gen(function* () {
          const { user } = yield* CurrentUser;
          const db = yield* PgAuthDB;
          return yield* withAuthContext(db, user.id, user.role,
            db.insertInto("app_public.practice_logs")
              .values({
                student_id: user.id,
                material_id: payload.material_id,
                status: payload.status,
                notes: payload.notes ?? null,
              })
              .returning(["id", "student_id", "material_id", "status", "notes", "logged_at"])
              .pipe(
                Effect.head,
                Effect.catchTag("NoSuchElementException", () =>
                  Effect.die(new Error("Insert returned no rows")),
                ),
                Effect.map((r) => ({ ...r, logged_at: r.logged_at.toISOString() })),
                Effect.orDie,
              ),
          ).pipe(Effect.orDie);
        }),
      )
      // Assignment notes
      .handle("assignmentNote", ({ path }) =>
        Effect.gen(function* () {
          const { user } = yield* CurrentUser;
          const db = yield* PgAuthDB;
          return yield* withAuthContext(db, user.id, user.role,
            db.selectFrom("app_public.assignment_notes")
              .selectAll()
              .where("material_id", "=", path.materialId)
              .pipe(
                Effect.head,
                Effect.map((r) => ({
                  ...r,
                  created_at: r.created_at.toISOString(),
                  updated_at: r.updated_at.toISOString(),
                })),
                Effect.catchTag("NoSuchElementException", () =>
                  Effect.succeed(null),
                ),
                Effect.orDie,
              ),
          ).pipe(Effect.orDie);
        }),
      )
      .handle("upsertAssignmentNote", ({ path, payload }) =>
        Effect.gen(function* () {
          const { user } = yield* CurrentUser;
          const db = yield* PgAuthDB;
          return yield* withAuthContext(db, user.id, user.role,
            db.insertInto("app_public.assignment_notes")
              .values({
                student_id: user.id,
                material_id: path.materialId,
                body: payload.body,
              })
              .onConflict((oc) =>
                oc.columns(["student_id", "material_id"]).doUpdateSet({
                  body: payload.body,
                  updated_at: new Date(),
                }),
              )
              .returning(["id", "student_id", "material_id", "body", "created_at", "updated_at"])
              .pipe(
                Effect.head,
                Effect.catchTag("NoSuchElementException", () =>
                  Effect.die(new Error("Upsert returned no rows")),
                ),
                Effect.map((r) => ({
                  ...r,
                  created_at: r.created_at.toISOString(),
                  updated_at: r.updated_at.toISOString(),
                })),
                Effect.orDie,
              ),
          ).pipe(Effect.orDie);
        }),
      )
      // Messaging
      .handle("messages", ({ urlParams }) =>
        Effect.gen(function* () {
          const { user } = yield* CurrentUser;
          const db = yield* PgAuthDB;
          return yield* withAuthContext(db, user.id, user.role,
            Effect.gen(function* () {
              let query = db
                .selectFrom("app_public.messages")
                .selectAll()
                .orderBy("created_at", "desc")
                .limit(urlParams.limit ?? 50)
                .offset(urlParams.offset ?? 0);
              if (urlParams.with) {
                query = query.where((eb) =>
                  eb.or([
                    eb("sender_id", "=", urlParams.with!),
                    eb("recipient_id", "=", urlParams.with!),
                  ]),
                );
              }
              return yield* query.pipe(
                Effect.map((rows) =>
                  rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() })),
                ),
                Effect.orDie,
              );
            }),
          ).pipe(Effect.orDie);
        }),
      )
      .handle("sendMessage", ({ payload }) =>
        Effect.gen(function* () {
          const { user } = yield* CurrentUser;
          const db = yield* PgAuthDB;
          return yield* withAuthContext(db, user.id, user.role,
            db.insertInto("app_public.messages")
              .values({
                sender_id: user.id,
                recipient_id: payload.recipient_id,
                body: payload.body,
              })
              .returning(["id", "sender_id", "recipient_id", "body", "is_read", "created_at"])
              .pipe(
                Effect.head,
                Effect.catchTag("NoSuchElementException", () =>
                  Effect.die(new Error("Insert returned no rows")),
                ),
                Effect.map((r) => ({ ...r, created_at: r.created_at.toISOString() })),
                Effect.orDie,
              ),
          ).pipe(Effect.orDie);
        }),
      )
      .handle("markMessageRead", ({ path }) =>
        Effect.gen(function* () {
          const { user } = yield* CurrentUser;
          const db = yield* PgAuthDB;
          yield* withAuthContext(db, user.id, user.role,
            db.updateTable("app_public.messages")
              .set({ is_read: true })
              .where("id", "=", path.id)
              .pipe(Effect.orDie),
          ).pipe(Effect.orDie);
          return { success: true as const };
        }),
      ),
);

// === Admin ===

const adminLive = HttpApiBuilder.group(DfgPortalApi, "admin", (handlers) =>
  handlers
    .handle("submissions", ({ urlParams }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        return yield* db
          .selectFrom("app_public.contact_submissions")
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(urlParams.limit ?? 50)
          .offset(urlParams.offset ?? 0)
          .pipe(
            Effect.map((rows) =>
              rows.map((r) => ({
                ...r,
                created_at: r.created_at.toISOString(),
              })),
            ),
            Effect.orDie,
          );
      }),
    )
    .handle("patchSubmission", ({ path, payload }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        yield* db
          .updateTable("app_public.contact_submissions")
          .set({ is_read: payload.is_read })
          .where("id", "=", path.id)
          .returning(["id"])
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementException", () =>
              Effect.fail(new NotFound({ error: "Submission not found" })),
            ),
            sqlOrDie,
          );
        return { success: true as const };
      }),
    )
    .handle("students", () =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        return yield* db
          .selectFrom("app_public.users")
          .select(["id", "username", "name", "email", "role"])
          .where("role", "=", "student")
          .pipe(Effect.orDie);
      }),
    )
    .handle("createStudent", ({ payload }) =>
      Effect.gen(function* () {
        return yield* AuthService.createStudent(payload).pipe(
          Effect.map((u) => ({
            id: u.id,
            username: u.username,
            name: u.name ?? "",
            email: u.email ?? "",
            role: u.role as UserRole,
          })),
          Effect.catchAll(() =>
            Effect.fail(
              new Conflict({ error: "Username or email already exists" }),
            ),
          ),
        );
      }),
    )
    .handle("studentDetail", ({ path }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        const student = yield* db
          .selectFrom("app_public.users")
          .select(["id", "username", "name", "email", "role"])
          .where("id", "=", path.id)
          .where("role", "=", "student")
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementException", () =>
              Effect.fail(new NotFound({ error: "Student not found" })),
            ),
            sqlOrDie,
          );

        const enrolled_courses = yield* db
          .selectFrom("app_public.enrollments as e")
          .innerJoin("app_public.courses as c", "c.id", "e.course_id")
          .where("e.student_id", "=", path.id)
          .select(["c.id", "c.title", "c.instrument"])
          .pipe(Effect.orDie);

        const assigned_materials = yield* db
          .selectFrom("app_public.student_materials as sm")
          .innerJoin("app_public.materials as m", "m.id", "sm.material_id")
          .where("sm.student_id", "=", path.id)
          .select([
            "m.id",
            "m.title",
            "m.original_filename",
            "m.mime_type",
            "m.file_size",
            "m.is_global",
          ])
          .pipe(Effect.orDie);

        return { ...student, enrolled_courses, assigned_materials };
      }),
    )
    .handle("adminCourses", () =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        return yield* db
          .selectFrom("app_public.courses")
          .select(["id", "title", "description", "instrument"])
          .pipe(Effect.orDie);
      }),
    )
    .handle("courseStudents", ({ path }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        return yield* db
          .selectFrom("app_public.enrollments as e")
          .innerJoin("app_public.users as u", "u.id", "e.student_id")
          .where("e.course_id", "=", path.id)
          .select(["u.id", "u.username", "u.name", "u.email", "u.role"])
          .pipe(Effect.orDie);
      }),
    )
    .handle("createCourse", ({ payload }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        return yield* db
          .insertInto("app_public.courses")
          .values({
            title: payload.title,
            description: payload.description ?? "",
            instrument: payload.instrument,
          })
          .returning(["id", "title", "description", "instrument"])
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementException", () =>
              Effect.die(new Error("Insert returned no rows")),
            ),
            Effect.orDie,
          );
      }),
    )
    .handle("updateCourse", ({ path, payload }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        const updates: Record<string, string> = {};
        if (payload.title !== undefined) updates.title = payload.title;
        if (payload.description !== undefined)
          updates.description = payload.description;
        if (payload.instrument !== undefined)
          updates.instrument = payload.instrument;

        return yield* db
          .updateTable("app_public.courses")
          .set(updates)
          .where("id", "=", path.id)
          .returning(["id", "title", "description", "instrument"])
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementException", () =>
              Effect.fail(new NotFound({ error: "Course not found" })),
            ),
            sqlOrDie,
          );
      }),
    )
    .handle("deleteCourse", ({ path }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        yield* db
          .deleteFrom("app_public.courses")
          .where("id", "=", path.id)
          .pipe(Effect.orDie);
        return { success: true as const };
      }),
    )
    .handle("createModule", ({ path, payload }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        return yield* db
          .insertInto("app_public.modules")
          .values({
            course_id: path.courseId,
            title: payload.title,
            description: payload.description ?? null,
            sort_order: payload.sort_order ?? 0,
          })
          .returning(["id", "course_id", "title", "description", "sort_order"])
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementException", () =>
              Effect.die(new Error("Insert returned no rows")),
            ),
            Effect.orDie,
          );
      }),
    )
    .handle("updateModule", ({ path, payload }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        const updates: Record<string, unknown> = {};
        if (payload.title !== undefined) updates.title = payload.title;
        if (payload.description !== undefined)
          updates.description = payload.description;
        if (payload.sort_order !== undefined)
          updates.sort_order = payload.sort_order;

        return yield* db
          .updateTable("app_public.modules")
          .set(updates)
          .where("id", "=", path.id)
          .returning(["id", "course_id", "title", "description", "sort_order"])
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementException", () =>
              Effect.fail(new NotFound({ error: "Module not found" })),
            ),
            sqlOrDie,
          );
      }),
    )
    .handle("deleteModule", ({ path }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        yield* db.deleteFrom("app_public.modules").where("id", "=", path.id).pipe(Effect.orDie);
        return { success: true as const };
      }),
    )
    .handle("attachMaterial", ({ path, payload }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        yield* db.insertInto("app_public.module_materials").values({
          module_id: path.id,
          material_id: payload.material_id,
          sort_order: payload.sort_order ?? 0,
        }).pipe(Effect.orDie);
        return { success: true as const };
      }),
    )
    .handle("detachMaterial", ({ path }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        yield* db
          .deleteFrom("app_public.module_materials")
          .where("module_id", "=", path.moduleId)
          .where("material_id", "=", path.materialId)
          .pipe(Effect.orDie);
        return { success: true as const };
      }),
    )
    .handle("enrollStudent", ({ path, payload }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        yield* db.insertInto("app_public.enrollments").values({
          student_id: path.id,
          course_id: payload.course_id,
        }).pipe(Effect.orDie);
        return { success: true as const };
      }),
    )
    .handle("unenrollStudent", ({ path }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        yield* db
          .deleteFrom("app_public.enrollments")
          .where("student_id", "=", path.id)
          .where("course_id", "=", path.courseId)
          .pipe(Effect.orDie);
        return { success: true as const };
      }),
    )
    .handle("assignMaterial", ({ path, payload }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        yield* db.insertInto("app_public.student_materials").values({
          student_id: path.id,
          material_id: payload.material_id,
        }).pipe(Effect.orDie);
        return { success: true as const };
      }),
    )
    .handle("unassignMaterial", ({ path }) =>
      Effect.gen(function* () {
        const db = yield* PgRootDB;
        yield* db
          .deleteFrom("app_public.student_materials")
          .where("student_id", "=", path.id)
          .where("material_id", "=", path.materialId)
          .pipe(Effect.orDie);
        return { success: true as const };
      }),
    ),
);

// === Compose ===

/** Individual handler layers (exported for testing API composition) */
export const handlerLayers = Layer.mergeAll(
  publicLive,
  authLive,
  authenticatedLive,
  adminLive,
);

export const HttpApiLive = HttpApiBuilder.api(DfgPortalApi).pipe(
  Layer.provide(handlerLayers),
  Layer.provide(SessionMiddlewareLive),
  Layer.provide(AuthMiddlewareLive),
  Layer.provide(AdminMiddlewareLive),
  Layer.provide(AuthService.Default),
  Layer.provide(SessionService.Default),
  Layer.provide(EmailService.Default),
  Layer.provide(RateLimiter.Default),
  Layer.provide(OAuthConfigLive),
  Layer.provide(PgRootDB.Live),
  Layer.provide(PgAuthDB.Live),
);
