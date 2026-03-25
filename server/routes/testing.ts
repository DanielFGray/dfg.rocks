/**
 * Testing API -- Elysia server-side test helpers for E2E tests.
 * Only loaded when NODE_ENV !== "production".
 */
import Elysia, { t } from "elysia";
import crypto from "crypto";
import { sql } from "kysely";
import { rootDb } from "../db.js";
import { sessionService } from "../services/sessionService.js";
import { HttpError, mapPgError } from "../pgErrors.js";
import { env } from "../assertEnv.js";

if (env.NODE_ENV === "production") {
  throw new Error("testing API must not be loaded in production");
}

// === Helpers ===

function setSessionCookie(
  cookie: Record<string, any>,
  token: string,
  expiresAt: Date,
): void {
  cookie.session.set({
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

type LoginParams = {
  username?: string;
  password?: string;
  role?: string;
  name?: string;
  email?: string;
};

async function loginHandler(
  params: LoginParams,
  cookie: Record<string, any>,
) {
  const username = params.username ?? "test_admin";
  const password = params.password ?? "testpassword123";
  const role = params.role ?? "admin";
  const name = params.name ?? username;
  const email = params.email ?? `${username}@test.local`;

  // Find existing user or create new one
  const existing = await rootDb
    .selectFrom("app_public.users")
    .select("id")
    .where("username", "=", username)
    .executeTakeFirst();

  let userId: string;

  if (existing) {
    userId = existing.id;
  } else {
    const created = await rootDb
      .selectFrom(
        sql<{ id: string }>`
          app_private.really_create_user(
            ${username}::citext,
            ${name},
            null,
            true,
            ${email}::citext,
            ${password}
          )
        `.as("u"),
      )
      .select("id")
      .executeTakeFirstOrThrow();

    userId = created.id;
  }

  // Set role if not default (really_create_user always creates as 'student')
  if (role !== "student") {
    await rootDb
      .updateTable("app_public.users")
      .set({ role: role as any })
      .where("id", "=", userId)
      .execute();
  }

  // Set password for existing users (new users already have password from really_create_user)
  try {
    await rootDb
      .updateTable("app_private.user_secrets")
      .set({ password_hash: sql`crypt(${password}, gen_salt('bf'))` })
      .where("user_id", "=", userId)
      .execute();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    mapPgError(err);
  }

  const session = await sessionService.createSession(userId);
  setSessionCookie(cookie, session.token, session.expiresAt);

  return { id: userId, username, email, name, role, is_verified: true };
}

// === Plugin ===

export const testingRoutes = new Elysia({ prefix: "/api" })
  .onError(({ error, set }) => {
    if (error instanceof HttpError) {
      set.status = error.status;
      return { error: error.message };
    }
  })

  // --- Login (POST) ---
  .post("/testing/login", async ({ body, cookie }) => {
    return await loginHandler(body, cookie);
  }, {
    body: t.Object({
      username: t.Optional(t.String()),
      password: t.Optional(t.String()),
      role: t.Optional(t.String()),
      name: t.Optional(t.String()),
      email: t.Optional(t.String()),
    }),
  })

  // --- Login (GET, redirects to /dashboard) ---
  .get("/testing/login", async ({ query, cookie, set }) => {
    await loginHandler(query, cookie);
    set.redirect = "/dashboard";
  }, {
    query: t.Object({
      username: t.Optional(t.String()),
      password: t.Optional(t.String()),
      role: t.Optional(t.String()),
      name: t.Optional(t.String()),
      email: t.Optional(t.String()),
    }),
  })

  // --- Clear test data ---
  .post("/testing/clear", async () => {
    // family_invitations, family_memberships cascade from families/users ON DELETE CASCADE
    await rootDb
      .deleteFrom("app_public.families")
      .where("slug", "like", "test-%")
      .execute();

    // lessons, lesson_notes, lesson_deposits cascade from users ON DELETE CASCADE
    await rootDb
      .deleteFrom("app_public.users")
      .where("username", "like", "test_%")
      .execute();

    await rootDb
      .deleteFrom("app_public.courses")
      .where("title", "like", "Test:%")
      .execute();

    return { success: true as const };
  })

  // --- Seed course ---
  .post("/testing/seed-course", async ({ body }) => {
    const course = await rootDb
      .insertInto("app_public.courses")
      .values({
        title: body.title,
        instrument: body.instrument,
        description: body.description ?? "",
      })
      .returning(["id", "title", "instrument", "description"])
      .executeTakeFirstOrThrow();

    const modules = await Promise.all(
      (body.modules ?? []).map(async (mod, i) => {
        const m = await rootDb
          .insertInto("app_public.modules")
          .values({
            course_id: course.id,
            title: mod.title,
            description: mod.description ?? null,
            sort_order: mod.sort_order ?? i + 1,
          })
          .returning(["id", "title", "description", "sort_order"])
          .executeTakeFirstOrThrow();
        return m;
      }),
    );

    return { ...course, modules };
  }, {
    body: t.Object({
      title: t.String(),
      instrument: t.String(),
      description: t.Optional(t.String()),
      modules: t.Optional(t.Array(t.Object({
        title: t.String(),
        description: t.Optional(t.String()),
        sort_order: t.Optional(t.Number()),
      }))),
    }),
  })

  // --- Enroll student ---
  .post("/testing/enroll", async ({ body }) => {
    const { student_id, course_id } = body;

    await rootDb
      .insertInto("app_public.enrollments")
      .values({ student_id, course_id })
      .onConflict((oc: any) => oc.doNothing())
      .execute();

    return { success: true as const };
  }, {
    body: t.Object({
      student_id: t.String(),
      course_id: t.String(),
    }),
  })

  // --- Seed invitation ---
  .post("/testing/seed-invitation", async ({ body }) => {
    const { email } = body;

    // Create a family for the invitation
    const family = await rootDb
      .insertInto("app_public.families")
      .values({ slug: `test-family-${Date.now()}`, name: "Test Family" })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    // Make the admin the family owner
    const admin = await rootDb
      .selectFrom("app_public.users")
      .select("id")
      .where("role", "=", "admin")
      .executeTakeFirst();

    if (!admin) throw new Error("No admin user found for seeding invitation");

    await rootDb
      .insertInto("app_public.family_memberships")
      .values({
        family_id: family.id,
        user_id: admin.id,
        is_owner: true,
        is_billing_contact: true,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();

    // Create the invitation
    const code = crypto.randomBytes(7).toString("hex");
    const invitation = await rootDb
      .insertInto("app_public.family_invitations")
      .values({ family_id: family.id, email, code })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    return { code, invitation_id: invitation.id };
  }, {
    body: t.Object({
      email: t.String(),
    }),
  })

  // --- Seed lesson ---
  .post("/testing/seed-lesson", async ({ body }) => {
    const lesson = await rootDb
      .insertInto("app_public.lessons")
      .values({
        student_id: body.student_id,
        scheduled_at: new Date(
          body.scheduled_at ?? new Date(Date.now() + 86400000).toISOString(),
        ),
        duration_minutes: body.duration_minutes ?? 60,
        location_type: (body.location_type ?? "online") as any,
        status: (body.status ?? "scheduled") as any,
      })
      .returning(["id", "student_id", "scheduled_at", "status"])
      .executeTakeFirstOrThrow();

    return {
      ...lesson,
      scheduled_at: (lesson.scheduled_at as Date).toISOString(),
    };
  }, {
    body: t.Object({
      student_id: t.String(),
      scheduled_at: t.Optional(t.String()),
      duration_minutes: t.Optional(t.Number()),
      location_type: t.Optional(t.String()),
      status: t.Optional(t.String()),
    }),
  });
