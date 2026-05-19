/**
 * Testing API -- Elysia server-side test helpers for E2E tests.
 * Only loaded when NODE_ENV !== "production".
 */
import Elysia, { t, type Static } from "elysia";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { sql } from "kysely";
import { rootDb } from "../db.js";
import { sessionService } from "../services/sessionService.js";
import { HttpError, mapPgError } from "../pgErrors.js";
import { env } from "../assertEnv.js";
import { disableRateLimiting } from "../services/rateLimiter.js";
import {
  extractNotationTracksFromBytes,
  resolveAssignedTrackIndex,
} from "../services/notationService.js";
import type { LessonStatus, LocationType } from "../../shared/schemas.js";

if (env.NODE_ENV === "production") {
  throw new Error("testing API must not be loaded in production");
}

disableRateLimiting();

// === Helpers ===

function setSessionCookie(cookie: Record<string, any>, token: string, expiresAt: Date): void {
  cookie.session.set({
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

const LoginParams = t.Object({
  username: t.Optional(t.String()),
  password: t.Optional(t.String()),
  role: t.Optional(t.Union([t.Literal("admin"), t.Literal("teacher"), t.Literal("student")])),
  name: t.Optional(t.String()),
  email: t.Optional(t.String()),
});

type LoginParams = Static<typeof LoginParams>;

async function loginHandler(params: LoginParams, cookie: Record<string, any>) {
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
    await rootDb.updateTable("app_public.users").set({ role }).where("id", "=", userId).execute();
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

  // --- Login ---
  .get(
    "/testing/login",
    async ({ query, cookie, redirect, request }) => {
      await loginHandler(query, cookie);
      return redirect(new URL("/dashboard", request.url).toString());
    },
    {
      query: LoginParams,
    },
  )

  .get(
    "/testing/testimonial-reminder",
    async ({ query, redirect, request }) => {
      const user = await rootDb
        .selectFrom("app_public.users")
        .select("id")
        .where("username", "=", query.username)
        .executeTakeFirstOrThrow();

      await rootDb
        .updateTable("app_private.user_secrets")
        .set({
          testimonial_prompt_enabled: query.prompt_enabled === "true",
          testimonial_next_prompt_at: query.next_prompt_at ? new Date(query.next_prompt_at) : null,
        })
        .where("user_id", "=", user.id)
        .execute();

      return redirect(new URL("/dashboard", request.url).toString());
    },
    {
      query: t.Object({
        username: t.String(),
        prompt_enabled: t.Optional(t.String()),
        next_prompt_at: t.Optional(t.String()),
      }),
    },
  )

  // --- Clear test data ---
  .get("/testing/clear", async ({ redirect, request }) => {
    // family_invitations, family_memberships cascade from families/users ON DELETE CASCADE
    await rootDb.deleteFrom("app_public.families").where("slug", "like", "test-%").execute();

    // lessons, lesson_notes, lesson_deposits cascade from users ON DELETE CASCADE
    await rootDb.deleteFrom("app_public.users").where("username", "like", "test_%").execute();

    await rootDb.deleteFrom("app_public.courses").where("title", "like", "Test:%").execute();

    const testMaterialFiles = await rootDb
      .selectFrom("app_public.materials")
      .select("file_path")
      .where((eb) =>
        eb.or([eb("file_path", "like", "/test/%"), eb("file_path", "like", "/tmp/test-%")]),
      )
      .execute();

    await rootDb
      .deleteFrom("app_public.materials")
      .where((eb) =>
        eb.or([eb("file_path", "like", "/test/%"), eb("file_path", "like", "/tmp/test-%")]),
      )
      .execute();

    await Promise.all(
      testMaterialFiles
        .filter((material) => material.file_path.startsWith("/tmp/test-"))
        .map((material) => fs.unlink(material.file_path).catch(() => {})),
    );

    return redirect(new URL("/login", request.url).toString());
  })

  // --- Seed course (POST — nested modules don't fit in query params) ---
  .post(
    "/testing/seed-course",
    async ({ body, redirect, request }) => {
      const course = await rootDb
        .insertInto("app_public.courses")
        .values({
          title: body.title,
          instrument: body.instrument,
          description: body.description ?? "",
        })
        .returning(["id", "title", "instrument", "description"])
        .executeTakeFirstOrThrow();

      await Promise.all(
        (body.modules ?? []).map(async (mod, i) => {
          await rootDb
            .insertInto("app_public.modules")
            .values({
              course_id: course.id,
              title: mod.title,
              sort_order: mod.sort_order ?? i + 1,
            })
            .execute();
        }),
      );

      return redirect(new URL(`/courses/${course.id}`, request.url).toString());
    },
    {
      body: t.Object({
        title: t.String(),
        instrument: t.String(),
        description: t.Optional(t.String()),
        modules: t.Optional(
          t.Array(
            t.Object({
              title: t.String(),
              sort_order: t.Optional(t.Number()),
            }),
          ),
        ),
      }),
    },
  )

  // --- Seed material ---
  .post(
    "/testing/seed-material",
    async ({ body, redirect, request }) => {
      const originalFilename =
        body.original_filename ?? `${body.title.toLowerCase().replace(/\s+/g, "-")}.pdf`;
      const filePath = body.source_file_path
        ? `/tmp/test-${crypto.randomUUID()}${path.extname(originalFilename)}`
        : `/test/${crypto.randomUUID()}-${originalFilename}`;

      if (body.source_file_path) {
        await fs.copyFile(body.source_file_path, filePath);
      }

      const notationTracks = body.source_file_path
        ? extractNotationTracksFromBytes(
            new Uint8Array(await fs.readFile(body.source_file_path)),
            originalFilename,
          )
        : null;

      const material = await rootDb
        .insertInto("app_public.materials")
        .values({
          title: body.title,
          original_filename: originalFilename,
          file_path: filePath,
          mime_type: body.mime_type ?? "application/pdf",
          file_size: body.file_size ?? 1024,
          is_global: body.is_global ?? false,
          notation_tracks:
            notationTracks === null ? null : sql`${JSON.stringify(notationTracks)}::jsonb`,
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      return redirect(new URL(`/library#${material.id}`, request.url).toString());
    },
    {
      body: t.Object({
        title: t.String(),
        original_filename: t.Optional(t.String()),
        mime_type: t.Optional(t.String()),
        file_size: t.Optional(t.Number()),
        is_global: t.Optional(t.Boolean()),
        source_file_path: t.Optional(t.String()),
      }),
    },
  )

  // --- Assign material ---
  .get(
    "/testing/assign-material",
    async ({ query, redirect, request }) => {
      const student = await rootDb
        .selectFrom("app_public.users")
        .select("id")
        .where("username", "=", query.username)
        .executeTakeFirstOrThrow();

      const material = await rootDb
        .selectFrom("app_public.materials")
        .select("id")
        .where("title", "=", query.material_title)
        .executeTakeFirstOrThrow();

      const assignedTrackIndex = await resolveAssignedTrackIndex(
        material.id,
        query.assigned_track_index,
      );

      await rootDb
        .insertInto("app_public.student_materials")
        .values({
          student_id: student.id,
          material_id: material.id,
          assigned_track_index: assignedTrackIndex,
        })
        .onConflict((oc: any) =>
          oc.columns(["student_id", "material_id"]).doUpdateSet({
            assigned_track_index: assignedTrackIndex,
          }),
        )
        .execute();

      return redirect(new URL(`/assignments#${material.id}`, request.url).toString());
    },
    {
      query: t.Object({
        username: t.String(),
        material_title: t.String(),
        assigned_track_index: t.Optional(t.Numeric()),
      }),
    },
  )

  // --- Enroll student ---
  .get(
    "/testing/enroll",
    async ({ query, redirect, request }) => {
      const student = await rootDb
        .selectFrom("app_public.users")
        .select("id")
        .where("username", "=", query.username)
        .executeTakeFirstOrThrow();

      const course = await rootDb
        .selectFrom("app_public.courses")
        .select("id")
        .where("title", "=", query.course_title)
        .executeTakeFirstOrThrow();

      await rootDb
        .insertInto("app_public.enrollments")
        .values({ student_id: student.id, course_id: course.id })
        .onConflict((oc: any) => oc.doNothing())
        .execute();

      return redirect(new URL(`/courses/${course.id}`, request.url).toString());
    },
    {
      query: t.Object({
        username: t.String(),
        course_title: t.String(),
      }),
    },
  )

  // --- Seed family ---
  .get(
    "/testing/seed-family",
    async ({ query, redirect, request }) => {
      const family = await rootDb
        .insertInto("app_public.families")
        .values({
          slug: query.slug ?? `test-family-${Date.now()}`,
          name: query.name ?? "Test Family",
        })
        .returning(["id", "slug", "name"])
        .executeTakeFirstOrThrow();

      if (query.owner_username) {
        const owner = await rootDb
          .selectFrom("app_public.users")
          .select("id")
          .where("username", "=", query.owner_username)
          .executeTakeFirstOrThrow();

        await rootDb
          .insertInto("app_public.family_memberships")
          .values({
            family_id: family.id,
            user_id: owner.id,
            is_owner: true,
            is_billing_contact: true,
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }

      return redirect(new URL("/students", request.url).toString());
    },
    {
      query: t.Object({
        name: t.Optional(t.String()),
        slug: t.Optional(t.String()),
        owner_username: t.Optional(t.String()),
      }),
    },
  )

  // --- Seed family membership ---
  .get(
    "/testing/seed-family-membership",
    async ({ query, redirect, request }) => {
      const user = await rootDb
        .selectFrom("app_public.users")
        .select("id")
        .where("username", "=", query.username)
        .executeTakeFirstOrThrow();

      const family = await rootDb
        .selectFrom("app_public.families")
        .select("id")
        .where("slug", "=", query.family_slug)
        .executeTakeFirstOrThrow();

      await rootDb
        .insertInto("app_public.family_memberships")
        .values({
          family_id: family.id,
          user_id: user.id,
          is_owner: query.is_owner === "true",
          is_billing_contact: query.is_billing_contact === "true",
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      return redirect(new URL("/students", request.url).toString());
    },
    {
      query: t.Object({
        username: t.String(),
        family_slug: t.String(),
        is_owner: t.Optional(t.String()),
        is_billing_contact: t.Optional(t.String()),
      }),
    },
  )

  // --- Seed invitation ---
  .get(
    "/testing/seed-invitation",
    async ({ query, redirect, request }) => {
      const { email } = query;

      let familyId: string;

      if (query.family_slug) {
        const family = await rootDb
          .selectFrom("app_public.families")
          .select("id")
          .where("slug", "=", query.family_slug)
          .executeTakeFirstOrThrow();
        familyId = family.id;
      } else {
        // Create a family for the invitation
        const family = await rootDb
          .insertInto("app_public.families")
          .values({ slug: `test-family-${Date.now()}`, name: "Test Family" })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        familyId = family.id;

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
            family_id: familyId,
            user_id: admin.id,
            is_owner: true,
            is_billing_contact: true,
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }

      // Create the invitation
      const code = crypto.randomBytes(7).toString("hex");
      const expiresAt = query.expires_at ? new Date(query.expires_at) : undefined;
      const invitation = await rootDb
        .insertInto("app_public.family_invitations")
        .values({
          family_id: familyId,
          email,
          code,
          ...(expiresAt ? { expires_at: expiresAt } : {}),
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      return redirect(
        new URL(`/accept-invite?id=${invitation.id}&code=${code}`, request.url).toString(),
      );
    },
    {
      query: t.Object({
        email: t.String(),
        family_slug: t.Optional(t.String()),
        expires_at: t.Optional(t.String()),
      }),
    },
  )

  .get(
    "/testing/seed-delete-account",
    async ({ query, redirect, request }) => {
      const user = await rootDb
        .selectFrom("app_public.users")
        .select("id")
        .where("username", "=", query.username)
        .executeTakeFirstOrThrow();

      const token = crypto.randomBytes(7).toString("hex");

      await rootDb
        .updateTable("app_private.user_secrets")
        .set({
          delete_account_token: token,
          delete_account_token_generated: new Date(),
        })
        .where("user_id", "=", user.id)
        .execute();

      return redirect(new URL(`/confirm-delete-account?token=${token}`, request.url).toString());
    },
    {
      query: t.Object({
        username: t.String(),
      }),
    },
  )

  // --- Seed lesson ---
  .get(
    "/testing/seed-lesson",
    async ({ query, redirect, request }) => {
      const student = await rootDb
        .selectFrom("app_public.users")
        .select("id")
        .where("username", "=", query.username)
        .executeTakeFirstOrThrow();

      await rootDb
        .insertInto("app_public.lessons")
        .values({
          student_id: student.id,
          scheduled_at: new Date(
            query.scheduled_at ?? new Date(Date.now() + 86400000).toISOString(),
          ),
          duration_minutes: query.duration_minutes ? Number(query.duration_minutes) : 60,
          location_type: (query.location_type ?? "online") as LocationType,
          status: (query.status ?? "scheduled") as LessonStatus,
        })
        .execute();

      return redirect(new URL("/my-lessons", request.url).toString());
    },
    {
      query: t.Object({
        username: t.String(),
        scheduled_at: t.Optional(t.String()),
        duration_minutes: t.Optional(t.String()),
        location_type: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    },
  );
