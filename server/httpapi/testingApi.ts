/**
 * Testing API — server-side test helpers for E2E tests.
 * Only loaded when NODE_ENV !== "production".
 *
 * Extends DfgPortalApi with a testing group and composes
 * into a single HttpApiLive layer for use with HttpApiBuilder.serve.
 */
import { HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Effect, Layer, Schema as S } from "effect";
import { sql } from "kysely";
import { DfgPortalApi } from "../../shared/contract.js";
import { UserRole } from "../../shared/schemas.js";
import { handlerLayers } from "./server.js";
import { PgRootDB, PgAuthDB } from "../db.js";
import { SessionService } from "../services/sessionService.js";
import {
  SessionMiddlewareLive,
  AuthMiddlewareLive,
  AdminMiddlewareLive,
  setSessionCookie,
} from "../services/sessionMiddleware.js";
import { AuthService } from "../services/authService.js";
import { EmailService } from "../services/emailService.js";
import { RateLimiter } from "../services/rateLimiter.js";
import { OAuthConfigLive } from "../services/oauthService.js";
import { env } from "../assertEnv.js";

if (env.NODE_ENV === "production") {
  throw new Error("testing API must not be loaded in production");
}

// === Schemas ===

const TestUserPayload = S.Struct({
  username: S.optional(S.String),
  password: S.optional(S.String),
  role: S.optional(UserRole),
  name: S.optional(S.String),
  email: S.optional(S.String),
});

const TestUserResponse = S.Struct({
  id: S.String,
  username: S.String,
  email: S.String,
  name: S.String,
  role: S.String,
});

const SeedCoursePayload = S.Struct({
  title: S.String,
  instrument: S.String,
  description: S.optional(S.String),
  modules: S.optional(
    S.Array(
      S.Struct({
        title: S.String,
        description: S.optional(S.String),
        sort_order: S.optional(S.Number),
      }),
    ),
  ),
});

const EnrollPayload = S.Struct({
  student_id: S.String,
  course_id: S.String,
});

const SuccessResponse = S.Struct({ success: S.Literal(true) });

// === Extend the base API with testing group ===

const TestingGroup = HttpApiGroup.make("testing")
  .add(
    HttpApiEndpoint.post("login", "/api/testing/login")
      .setPayload(TestUserPayload)
      .addSuccess(TestUserResponse),
  )
  .add(
    HttpApiEndpoint.get("loginGet", "/api/testing/login")
      .setUrlParams(TestUserPayload)
      .addSuccess(TestUserResponse),
  )
  .add(
    HttpApiEndpoint.post("clear", "/api/testing/clear")
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("seedCourse", "/api/testing/seed-course")
      .setPayload(SeedCoursePayload)
      .addSuccess(S.Any),
  )
  .add(
    HttpApiEndpoint.post("enroll", "/api/testing/enroll")
      .setPayload(EnrollPayload)
      .addSuccess(SuccessResponse),
  );

const DfgPortalTestingApi = DfgPortalApi.add(TestingGroup);

// === Handlers ===

const loginHandler = (params: typeof TestUserPayload.Type) =>
  Effect.gen(function* () {
    const db = yield* PgRootDB;
    const username = params.username ?? "test_admin";
    const password = params.password ?? "testpassword123";
    const role = params.role ?? "admin";
    const name = params.name ?? username;
    const email = params.email ?? `${username}@test.local`;

    // Find existing user or create new one
    const userId = yield* db
      .selectFrom("app_public.users" as any)
      .select("id")
      .where("username", "=", username)
      .pipe(
        Effect.head,
        Effect.map((u: any) => u.id as string),
        Effect.catchTag("NoSuchElementException", () =>
          db
            .selectFrom(
              sql<{ id: string }>`
                app_private.create_user(
                  ${username}::citext,
                  ${email}::citext,
                  ${name},
                  ${role}::app_public.user_role
                )
              `.as("u"),
            )
            .select("id")
            .pipe(Effect.head, Effect.orDie, Effect.map((u) => u.id)),
        ),
      );

    yield* db.selectNoFrom([
      sql`app_private.set_password(${userId}::uuid, ${password})`.as("_"),
    ]);

    const sessionService = yield* SessionService;
    const session = yield* sessionService.createSession(userId);

    yield* setSessionCookie(session.token, session.expiresAt);

    return { id: userId, username, email, name, role };
  }).pipe(Effect.orDie);

const testingHandlers = HttpApiBuilder.group(
  DfgPortalTestingApi,
  "testing",
  (handlers) =>
    handlers
      .handle("login", ({ payload }) => loginHandler(payload))
      .handle("loginGet", ({ urlParams }) => loginHandler(urlParams))
      .handle("clear", () =>
        Effect.gen(function* () {
          const db = yield* PgRootDB;
          yield* db
            .deleteFrom("app_public.users" as any)
            .where("username", "like", "test_%");
          yield* db
            .deleteFrom("app_public.courses" as any)
            .where("title", "like", "Test:%");
          return { success: true as const };
        }).pipe(Effect.orDie),
      )
      .handle("seedCourse", ({ payload }) =>
        Effect.gen(function* () {
          const db = yield* PgRootDB;
          const course = yield* db
            .insertInto("app_public.courses" as any)
            .values({
              title: payload.title,
              instrument: payload.instrument,
              description: payload.description ?? "",
            })
            .returning(["id", "title", "instrument", "description"])
            .pipe(Effect.head, Effect.orDie);

          const modules = [];
          for (const [i, mod] of (payload.modules ?? []).entries()) {
            const m = yield* db
              .insertInto("app_public.modules" as any)
              .values({
                course_id: (course as any).id,
                title: mod.title,
                description: mod.description ?? null,
                sort_order: mod.sort_order ?? i + 1,
              })
              .returning(["id", "title", "description", "sort_order"])
              .pipe(Effect.head, Effect.orDie);
            modules.push(m);
          }

          return { ...course, modules };
        }).pipe(Effect.orDie),
      )
      .handle("enroll", ({ payload }) =>
        Effect.gen(function* () {
          const db = yield* PgRootDB;
          yield* db
            .insertInto("app_public.enrollments" as any)
            .values({
              student_id: payload.student_id,
              course_id: payload.course_id,
            });
          return { success: true as const };
        }).pipe(Effect.orDie),
      ),
);

// === Composed API layer with testing endpoints ===

export const TestingApiLive = HttpApiBuilder.api(DfgPortalTestingApi).pipe(
  Layer.provide(handlerLayers),
  Layer.provide(testingHandlers),
  Layer.provide(SessionMiddlewareLive),
  Layer.provide(AuthMiddlewareLive),
  Layer.provide(AdminMiddlewareLive),
  Layer.provide(AuthService.Default),
  Layer.provide(SessionService.Default),
  Layer.provide(EmailService.Default),
  Layer.provide(RateLimiter.Disabled),
  Layer.provide(OAuthConfigLive),
  Layer.provide(PgRootDB.Live),
  Layer.provide(PgAuthDB.Live),
);
