import Elysia, { t } from "elysia";
import { sql } from "kysely";
import { rootDb, withAuthContext } from "../db.js";
import { sessionService } from "../services/sessionService.js";
import { googleCalendarService } from "../services/googleCalendarService.js";
import { fileService } from "../services/fileService.js";
import { HttpError, mapPgError } from "../pgErrors.js";
import { env } from "../assertEnv.js";
import type { UserRole } from "../../shared/schemas.js";

// === Shared schemas ===

const LocationType = t.Union([
  t.Literal("in_person_teacher_travels"),
  t.Literal("in_person_student_travels"),
  t.Literal("studio"),
  t.Literal("online"),
]);

const LessonStatus = t.Union([
  t.Literal("scheduled"),
  t.Literal("completed"),
  t.Literal("cancelled"),
  t.Literal("no_show"),
]);

// === Helpers ===

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function serializeLesson(r: {
  scheduled_at: Date | string;
  cancelled_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  [key: string]: unknown;
}) {
  return {
    ...r,
    scheduled_at: (r.scheduled_at as Date).toISOString(),
    cancelled_at: r.cancelled_at ? (r.cancelled_at as Date).toISOString() : null,
    completed_at: r.completed_at ? (r.completed_at as Date).toISOString() : null,
    created_at: (r.created_at as Date).toISOString(),
  };
}

function serializeLessonNote(r: {
  material_ids: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  [key: string]: unknown;
}) {
  return {
    ...r,
    material_ids: (r.material_ids ?? null) as string[] | null,
    created_at: (r.created_at as Date).toISOString(),
    updated_at: (r.updated_at as Date).toISOString(),
  };
}

// === Plugin ===

export const adminRoutes = new Elysia({ prefix: "/api/admin" })
  .onError(({ error, set }) => {
    if (error instanceof HttpError) {
      set.status = error.status;
      return { error: error.message };
    }
  })
  .derive(async ({ cookie, headers }) => {
    const token = cookie.session?.value as string | undefined;
    const result = await sessionService.validateSessionToken(token);
    if (!result) throw new HttpError(401, "Unauthorized");
    if (result.user.role !== "admin") throw new HttpError(403, "Forbidden");
    if (!headers["x-requested-with"]) throw new HttpError(403, "Missing CSRF header");
    return { auth: result };
  })

  // --- Submissions ---

  .get("/submissions", async ({ query }) => {
    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const rows = await rootDb
      .selectFrom("app_public.contact_submissions")
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    return rows.map((r) => ({
      ...r,
      created_at: r.created_at.toISOString(),
    }));
  }, {
    query: t.Object({
      limit: t.Optional(t.Numeric()),
      offset: t.Optional(t.Numeric()),
    }),
  })

  .patch("/submissions/:id", async ({ params, body }) => {
    const { is_read } = body;

    const row = await rootDb
      .updateTable("app_public.contact_submissions")
      .set({ is_read })
      .where("id", "=", params.id)
      .returning(["id"])
      .executeTakeFirst();

    if (!row) throw new HttpError(404, "Submission not found");

    return { success: true as const };
  }, {
    body: t.Object({
      is_read: t.Boolean(),
    }),
  })

  // --- Students ---

  .get("/students", async () => {
    const rows = await rootDb
      .selectFrom("app_public.users")
      .select(["id", "username", "name", "role", "is_verified"])
      .select((eb) =>
        eb.selectFrom("app_public.user_emails")
          .select("email")
          .whereRef("app_public.user_emails.user_id", "=", "app_public.users.id")
          .where("is_primary", "=", true)
          .limit(1)
          .as("email"),
      )
      .where("role", "=", "student")
      .execute();

    return rows.map((r) => ({
      ...r,
      name: r.name ?? "",
      email: r.email ?? "",
      role: r.role as UserRole,
    }));
  })

  .get("/students/:id", async ({ params }) => {
    const raw = await rootDb
      .selectFrom("app_public.users")
      .select(["id", "username", "name", "role", "is_verified"])
      .select((eb) =>
        eb.selectFrom("app_public.user_emails")
          .select("email")
          .whereRef("app_public.user_emails.user_id", "=", "app_public.users.id")
          .where("is_primary", "=", true)
          .limit(1)
          .as("email"),
      )
      .where("id", "=", params.id)
      .where("role", "=", "student")
      .executeTakeFirst();

    if (!raw) throw new HttpError(404, "Student not found");

    const student = {
      ...raw,
      name: raw.name ?? "",
      email: raw.email ?? "",
      role: raw.role as UserRole,
    };

    const enrolled_courses = await rootDb
      .selectFrom("app_public.enrollments as e")
      .innerJoin("app_public.courses as c", "c.id", "e.course_id")
      .where("e.student_id", "=", params.id)
      .select(["c.id", "c.title", "c.instrument"])
      .execute();

    const assigned_materials = await rootDb
      .selectFrom("app_public.student_materials as sm")
      .innerJoin("app_public.materials as m", "m.id", "sm.material_id")
      .where("sm.student_id", "=", params.id)
      .select([
        "m.id",
        "m.title",
        "m.original_filename",
        "m.mime_type",
        "m.file_size",
        "m.is_global",
      ])
      .execute();

    return { ...student, enrolled_courses, assigned_materials };
  })

  // --- Courses ---

  .get("/courses", async () => {
    return await rootDb
      .selectFrom("app_public.courses")
      .select(["id", "title", "description", "instrument"])
      .execute();
  })

  .get("/courses/:id/students", async ({ params }) => {
    const rows = await rootDb
      .selectFrom("app_public.enrollments as e")
      .innerJoin("app_public.users as u", "u.id", "e.student_id")
      .where("e.course_id", "=", params.id)
      .select(["u.id", "u.username", "u.name", "u.role", "u.is_verified"])
      .select((eb) =>
        eb.selectFrom("app_public.user_emails")
          .select("email")
          .whereRef("app_public.user_emails.user_id", "=", "u.id")
          .where("is_primary", "=", true)
          .limit(1)
          .as("email"),
      )
      .execute();

    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      name: r.name ?? "",
      email: r.email ?? "",
      role: r.role as UserRole,
      is_verified: r.is_verified,
    }));
  })

  .post("/courses", async ({ body }) => {
    const { title, description, instrument } = body;

    const course = await rootDb
      .insertInto("app_public.courses")
      .values({
        title,
        description: description ?? "",
        instrument,
      })
      .returning(["id", "title", "description", "instrument"])
      .executeTakeFirstOrThrow();

    return course;
  }, {
    body: t.Object({
      title: t.String(),
      description: t.Optional(t.String()),
      instrument: t.String(),
    }),
  })

  .patch("/courses/:id", async ({ params, body }) => {
    const updates: Record<string, string> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.instrument !== undefined) updates.instrument = body.instrument;

    const course = await rootDb
      .updateTable("app_public.courses")
      .set(updates)
      .where("id", "=", params.id)
      .returning(["id", "title", "description", "instrument"])
      .executeTakeFirst();

    if (!course) throw new HttpError(404, "Course not found");

    return course;
  }, {
    body: t.Object({
      title: t.Optional(t.String()),
      description: t.Optional(t.String()),
      instrument: t.Optional(t.String()),
    }),
  })

  .delete("/courses/:id", async ({ params }) => {
    await rootDb
      .deleteFrom("app_public.courses")
      .where("id", "=", params.id)
      .execute();

    return { success: true as const };
  })

  // --- Modules ---

  .post("/courses/:id/modules", async ({ params, body }) => {
    const { title, description, sort_order } = body;

    const mod = await rootDb
      .insertInto("app_public.modules")
      .values({
        course_id: params.id,
        title,
        description: description ?? null,
        sort_order: sort_order ?? 0,
      })
      .returning(["id", "course_id", "title", "description", "sort_order"])
      .executeTakeFirstOrThrow();

    return mod;
  }, {
    body: t.Object({
      title: t.String(),
      description: t.Optional(t.String()),
      sort_order: t.Optional(t.Number()),
    }),
  })

  .patch("/modules/:id", async ({ params, body }) => {
    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.sort_order !== undefined) updates.sort_order = body.sort_order;

    const mod = await rootDb
      .updateTable("app_public.modules")
      .set(updates)
      .where("id", "=", params.id)
      .returning(["id", "course_id", "title", "description", "sort_order"])
      .executeTakeFirst();

    if (!mod) throw new HttpError(404, "Module not found");

    return mod;
  }, {
    body: t.Object({
      title: t.Optional(t.String()),
      description: t.Optional(t.String()),
      sort_order: t.Optional(t.Number()),
    }),
  })

  .delete("/modules/:id", async ({ params }) => {
    await rootDb
      .deleteFrom("app_public.modules")
      .where("id", "=", params.id)
      .execute();

    return { success: true as const };
  })

  // --- Module materials ---

  .post("/modules/:id/materials", async ({ params, body }) => {
    const { material_id, sort_order } = body;

    await rootDb
      .insertInto("app_public.module_materials")
      .values({
        module_id: params.id,
        material_id,
        sort_order: sort_order ?? 0,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();

    return { success: true as const };
  }, {
    body: t.Object({
      material_id: t.String(),
      sort_order: t.Optional(t.Number()),
    }),
  })

  .delete("/modules/:id/materials/:materialId", async ({ params }) => {
    await rootDb
      .deleteFrom("app_public.module_materials")
      .where("module_id", "=", params.id)
      .where("material_id", "=", params.materialId)
      .execute();

    return { success: true as const };
  })

  // --- Enrollment ---

  .post("/students/:id/enroll", async ({ params, body }) => {
    const { course_id } = body;

    await rootDb
      .insertInto("app_public.enrollments")
      .values({
        student_id: params.id,
        course_id,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();

    return { success: true as const };
  }, {
    body: t.Object({
      course_id: t.String(),
    }),
  })

  .delete("/students/:id/enroll/:courseId", async ({ params }) => {
    await rootDb
      .deleteFrom("app_public.enrollments")
      .where("student_id", "=", params.id)
      .where("course_id", "=", params.courseId)
      .execute();

    return { success: true as const };
  })

  // --- Student materials ---

  .post("/students/:id/assign", async ({ params, body }) => {
    const { material_id } = body;

    await rootDb
      .insertInto("app_public.student_materials")
      .values({
        student_id: params.id,
        material_id,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();

    return { success: true as const };
  }, {
    body: t.Object({
      material_id: t.String(),
    }),
  })

  .delete("/students/:id/assign/:materialId", async ({ params }) => {
    await rootDb
      .deleteFrom("app_public.student_materials")
      .where("student_id", "=", params.id)
      .where("material_id", "=", params.materialId)
      .execute();

    return { success: true as const };
  })

  // --- Materials ---

  .delete("/materials/:id", async ({ params }) => {
    const row = await rootDb
      .deleteFrom("app_public.materials")
      .where("id", "=", params.id)
      .returning("id")
      .executeTakeFirst();

    if (!row) throw new HttpError(404, "Material not found");

    return { success: true as const };
  })

  // --- File upload (admin only, multipart) ---

  .post("/materials/upload", async ({ request, auth }) => {
    const formData = await request.formData();

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      throw new HttpError(400, "No file provided");
    }

    const title = formData.get("title");
    if (!title || typeof title !== "string") {
      throw new HttpError(400, "Title is required");
    }

    const isGlobalRaw = formData.get("is_global");
    const isGlobal = isGlobalRaw === "true" || isGlobalRaw === "1";

    const material = await fileService.upload(file, title, isGlobal, auth.user.id);
    return material;
  })

  // --- Families ---

  .post("/families", async ({ body, auth }) => {
    const { slug, name } = body;

    try {
      const family = await withAuthContext(auth.session.id, async (trx) => {
        return await trx
          .selectFrom(
            sql<{ id: string; slug: string; name: string; description: string | null; created_at: Date }>`
              app_public.create_family(${slug}::citext, ${name})
            `.as("f"),
          )
          .selectAll()
          .executeTakeFirstOrThrow();
      });

      return {
        ...family,
        created_at: (family.created_at as Date).toISOString(),
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      mapPgError(err);
    }
  }, {
    body: t.Object({
      slug: t.String(),
      name: t.String(),
    }),
  })

  .get("/families", async () => {
    const rows = await rootDb
      .selectFrom("app_public.families")
      .select(["id", "slug", "name", "description", "created_at"])
      .orderBy("created_at", "desc")
      .execute();

    return rows.map((r) => ({
      ...r,
      created_at: (r.created_at as Date).toISOString(),
    }));
  })

  .post("/families/:familyId/invite", async ({ params, body, auth }) => {
    const { username, email } = body;

    try {
      await withAuthContext(auth.session.id, async (trx) => {
        await sql`app_public.invite_to_family(
          ${params.familyId}::uuid,
          ${username ?? null}::citext,
          ${email ?? null}::citext
        )`.execute(trx);
      });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      mapPgError(err);
    }

    return { success: true as const };
  }, {
    body: t.Object({
      username: t.Optional(t.String()),
      email: t.Optional(t.String()),
    }),
  })

  .get("/families/:familyId/invitations", async ({ params }) => {
    return await rootDb
      .selectFrom("app_public.family_invitations as fi")
      .innerJoin("app_public.families as f", "f.id", "fi.family_id")
      .select([
        "fi.id",
        "fi.family_id",
        "f.name as family_name",
        "fi.code",
        "fi.user_id",
        "fi.email",
      ])
      .where("fi.family_id", "=", params.familyId)
      .execute();
  })

  // --- Lessons ---

  .post("/lessons", async ({ body }) => {
    const lesson = await rootDb
      .insertInto("app_public.lessons")
      .values({
        student_id: body.student_id,
        scheduled_at: new Date(body.scheduled_at),
        duration_minutes: body.duration_minutes,
        location_type: body.location_type as any,
        gcal_event_id: body.gcal_event_id ?? null,
      })
      .returning([
        "id", "student_id", "gcal_event_id", "scheduled_at",
        "duration_minutes", "location_type", "status",
        "cancellation_reason", "cancelled_at", "completed_at", "created_at",
      ])
      .executeTakeFirstOrThrow();

    // Best-effort gcal event creation
    try {
      const connected = await googleCalendarService.isConnected();
      if (connected && lesson.scheduled_at) {
        const student = await rootDb
          .selectFrom("app_public.users")
          .select(["name"])
          .where("id", "=", lesson.student_id)
          .executeTakeFirst();

        const studentName = student?.name ?? "Student";
        const startTime = new Date(lesson.scheduled_at as unknown as string);
        const endTime = new Date(startTime.getTime() + lesson.duration_minutes * 60000);

        const eventId = await googleCalendarService.createEvent({
          summary: `Lesson: ${studentName}`,
          description: `${lesson.duration_minutes} min ${lesson.location_type.replace(/_/g, " ")} lesson`,
          start: startTime.toISOString(),
          end: endTime.toISOString(),
        });

        if (eventId) {
          await rootDb
            .updateTable("app_public.lessons")
            .set({ gcal_event_id: eventId })
            .where("id", "=", lesson.id)
            .execute();
        }
      }
    } catch {
      // gcal errors are non-fatal
    }

    // Re-fetch to get potentially updated gcal_event_id
    const updated = await rootDb
      .selectFrom("app_public.lessons")
      .select([
        "id", "student_id", "gcal_event_id", "scheduled_at",
        "duration_minutes", "location_type", "status",
        "cancellation_reason", "cancelled_at", "completed_at", "created_at",
      ])
      .where("id", "=", lesson.id)
      .executeTakeFirst();

    return serializeLesson(updated ?? lesson);
  }, {
    body: t.Object({
      student_id: t.String(),
      scheduled_at: t.String(),
      duration_minutes: t.Number(),
      location_type: LocationType,
      gcal_event_id: t.Optional(t.String()),
    }),
  })

  .patch("/lessons/:id", async ({ params, body }) => {
    const updates: Record<string, unknown> = {};
    if (body.scheduled_at !== undefined) updates.scheduled_at = new Date(body.scheduled_at);
    if (body.duration_minutes !== undefined) updates.duration_minutes = body.duration_minutes;
    if (body.location_type !== undefined) updates.location_type = body.location_type;
    if (body.status !== undefined) {
      updates.status = body.status;
      if (body.status === "cancelled") updates.cancelled_at = new Date();
      if (body.status === "completed") updates.completed_at = new Date();
    }
    if (body.cancellation_reason !== undefined) updates.cancellation_reason = body.cancellation_reason;

    const lesson = await rootDb
      .updateTable("app_public.lessons")
      .set(updates)
      .where("id", "=", params.id)
      .returning([
        "id", "student_id", "gcal_event_id", "scheduled_at",
        "duration_minutes", "location_type", "status",
        "cancellation_reason", "cancelled_at", "completed_at", "created_at",
      ])
      .executeTakeFirst();

    if (!lesson) throw new HttpError(404, "Lesson not found");

    // Best-effort gcal cleanup on cancellation
    if (body.status === "cancelled" && lesson.gcal_event_id) {
      try {
        await googleCalendarService.deleteEvent(lesson.gcal_event_id);
      } catch {
        // gcal errors are non-fatal
      }
    }

    return serializeLesson(lesson);
  }, {
    body: t.Object({
      scheduled_at: t.Optional(t.String()),
      duration_minutes: t.Optional(t.Number()),
      location_type: t.Optional(LocationType),
      status: t.Optional(LessonStatus),
      cancellation_reason: t.Optional(t.String()),
    }),
  })

  .delete("/lessons/:id", async ({ params }) => {
    // Fetch lesson first to check for gcal_event_id
    const lesson = await rootDb
      .selectFrom("app_public.lessons")
      .select(["id", "gcal_event_id"])
      .where("id", "=", params.id)
      .executeTakeFirst();

    if (!lesson) throw new HttpError(404, "Lesson not found");

    // Best-effort gcal cleanup
    if (lesson.gcal_event_id) {
      try {
        await googleCalendarService.deleteEvent(lesson.gcal_event_id);
      } catch {
        // gcal errors are non-fatal
      }
    }

    await rootDb
      .deleteFrom("app_public.lessons")
      .where("id", "=", params.id)
      .execute();

    return { success: true as const };
  })

  .get("/lessons", async ({ query }) => {
    const limit = query.limit || 50;
    const offset = query.offset || 0;

    let q = rootDb
      .selectFrom("app_public.lessons")
      .select([
        "id", "student_id", "gcal_event_id", "scheduled_at",
        "duration_minutes", "location_type", "status",
        "cancellation_reason", "cancelled_at", "completed_at", "created_at",
      ])
      .orderBy("scheduled_at", "desc")
      .limit(limit)
      .offset(offset);

    if (query.student_id) q = q.where("student_id", "=", query.student_id);
    if (query.status) q = q.where("status", "=", query.status as "scheduled");
    if (query.from) q = q.where("scheduled_at", ">=", new Date(query.from));
    if (query.to) q = q.where("scheduled_at", "<=", new Date(query.to));

    const rows = await q.execute();

    return rows.map(serializeLesson);
  }, {
    query: t.Object({
      limit: t.Optional(t.Numeric()),
      offset: t.Optional(t.Numeric()),
      student_id: t.Optional(t.String()),
      status: t.Optional(t.String()),
      from: t.Optional(t.String()),
      to: t.Optional(t.String()),
    }),
  })

  // --- Student rates ---

  .post("/student-rates", async ({ body }) => {
    const rate = await rootDb
      .insertInto("app_public.student_rates")
      .values({
        student_id: body.student_id,
        rate_cents: body.rate_cents,
        lesson_duration_minutes: body.lesson_duration_minutes,
        location_type: body.location_type as any,
        notes: body.notes ?? null,
      })
      .onConflict((oc) =>
        oc.columns(["student_id", "location_type"]).doUpdateSet({
          rate_cents: body.rate_cents,
          lesson_duration_minutes: body.lesson_duration_minutes,
          notes: body.notes ?? null,
        }),
      )
      .returning([
        "id", "student_id", "rate_cents",
        "lesson_duration_minutes", "location_type", "notes", "created_at",
      ])
      .executeTakeFirstOrThrow();

    return {
      ...rate,
      created_at: (rate.created_at as Date).toISOString(),
    };
  }, {
    body: t.Object({
      student_id: t.String(),
      rate_cents: t.Number(),
      lesson_duration_minutes: t.Number(),
      location_type: LocationType,
      notes: t.Optional(t.String()),
    }),
  })

  .get("/student-rates/:studentId", async ({ params, query }) => {
    let q = rootDb
      .selectFrom("app_public.student_rates")
      .select([
        "id", "student_id", "rate_cents",
        "lesson_duration_minutes", "location_type", "notes", "created_at",
      ])
      .where("student_id", "=", params.studentId);

    if (query.location_type) {
      q = q.where("location_type", "=", query.location_type as "studio");
    }

    const rows = await q.execute();

    return rows.map((r) => ({
      ...r,
      created_at: (r.created_at as Date).toISOString(),
    }));
  }, {
    query: t.Object({
      location_type: t.Optional(t.String()),
    }),
  })

  // --- Lesson notes ---

  .post("/lessons/:id/notes", async ({ params, body }) => {
    const note = await rootDb
      .insertInto("app_public.lesson_notes")
      .values({
        lesson_id: params.id,
        topics_covered: body.topics_covered ?? null,
        homework: body.homework ?? null,
        progress_observations: body.progress_observations ?? null,
        notes: body.notes ?? null,
        material_ids: body.material_ids ? [...body.material_ids] : null,
        draft: body.draft ?? true,
      })
      .onConflict((oc) =>
        oc.column("lesson_id").doUpdateSet({
          topics_covered: body.topics_covered ?? null,
          homework: body.homework ?? null,
          progress_observations: body.progress_observations ?? null,
          notes: body.notes ?? null,
          material_ids: body.material_ids ? [...body.material_ids] : null,
          draft: body.draft ?? true,
        }),
      )
      .returning([
        "id", "lesson_id", "topics_covered", "homework",
        "progress_observations", "notes", "material_ids",
        "draft", "created_at", "updated_at",
      ])
      .executeTakeFirstOrThrow();

    return serializeLessonNote(note);
  }, {
    body: t.Object({
      topics_covered: t.Optional(t.String()),
      homework: t.Optional(t.String()),
      progress_observations: t.Optional(t.String()),
      notes: t.Optional(t.String()),
      material_ids: t.Optional(t.Array(t.String())),
      draft: t.Optional(t.Boolean()),
    }),
  })

  .get("/lessons/:id/notes", async ({ params }) => {
    const note = await rootDb
      .selectFrom("app_public.lesson_notes")
      .select([
        "id", "lesson_id", "topics_covered", "homework",
        "progress_observations", "notes", "material_ids",
        "draft", "created_at", "updated_at",
      ])
      .where("lesson_id", "=", params.id)
      .executeTakeFirst();

    if (!note) throw new HttpError(404, "Lesson note not found");

    return serializeLessonNote(note);
  })

  .patch("/lessons/:id/notes/publish", async ({ params }) => {
    const note = await rootDb
      .updateTable("app_public.lesson_notes")
      .set({ draft: false })
      .where("lesson_id", "=", params.id)
      .returning([
        "id", "lesson_id", "topics_covered", "homework",
        "progress_observations", "notes", "material_ids",
        "draft", "created_at", "updated_at",
      ])
      .executeTakeFirst();

    if (!note) throw new HttpError(404, "Lesson note not found");

    return serializeLessonNote(note);
  })

  // --- Google Calendar ---

  .get("/gcal/status", async () => {
    const tokenRow = await rootDb
      .selectFrom("app_private.admin_settings")
      .select("value")
      .where("key", "=", "gcal_refresh_token")
      .executeTakeFirst();

    const calIdRow = await rootDb
      .selectFrom("app_private.admin_settings")
      .select("value")
      .where("key", "=", "gcal_calendar_id")
      .executeTakeFirst();

    return {
      connected: tokenRow !== undefined,
      calendar_id: calIdRow ? (calIdRow.value as string) : null,
    };
  })

  .get("/gcal/auth-url", () => {
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "";
    const redirectUri = `${env.VITE_ROOT_URL ?? `http://localhost:${env.PORT}`}/api/admin/gcal/callback`;
    const scope = "https://www.googleapis.com/auth/calendar.events";
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;
    return { url };
  })

  .get("/gcal/callback", async ({ query, set }) => {
    const { code } = query;

    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "";
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "";
    const redirectUri = `${env.VITE_ROOT_URL ?? `http://localhost:${env.PORT}`}/api/admin/gcal/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new HttpError(400, `Google OAuth error: ${text}`);
    }

    const tokenData = (await tokenRes.json()) as Record<string, unknown>;
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in;

    if (typeof accessToken !== "string") {
      throw new HttpError(400, "No access_token in response");
    }

    // Store refresh token
    if (typeof refreshToken === "string") {
      await rootDb
        .insertInto("app_private.admin_settings")
        .values({ key: "gcal_refresh_token", value: toJson(refreshToken) })
        .onConflict((oc) => oc.column("key").doUpdateSet({ value: toJson(refreshToken) }))
        .execute();
    }

    // Store access token + expiry
    await rootDb
      .insertInto("app_private.admin_settings")
      .values({ key: "gcal_access_token", value: toJson(accessToken) })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value: toJson(accessToken) }))
      .execute();

    const expiresAt = new Date(
      Date.now() + (typeof expiresIn === "number" ? expiresIn : 3600) * 1000,
    ).toISOString();
    await rootDb
      .insertInto("app_private.admin_settings")
      .values({ key: "gcal_access_token_expires_at", value: toJson(expiresAt) })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value: toJson(expiresAt) }))
      .execute();

    // Default calendar to "primary"
    await rootDb
      .insertInto("app_private.admin_settings")
      .values({ key: "gcal_calendar_id", value: toJson("primary") })
      .onConflict((oc) => oc.column("key").doNothing())
      .execute();

    return { success: true as const };
  }, {
    query: t.Object({
      code: t.String(),
    }),
  })

  .post("/gcal/disconnect", async () => {
    await rootDb
      .deleteFrom("app_private.admin_settings")
      .where("key", "in", [
        "gcal_refresh_token",
        "gcal_access_token",
        "gcal_access_token_expires_at",
        "gcal_calendar_id",
        "gcal_sync_token",
      ])
      .execute();

    return { success: true as const };
  })

  // --- Working hours ---

  .get("/working-hours", async () => {
    const row = await rootDb
      .selectFrom("app_private.admin_settings")
      .select("value")
      .where("key", "=", "working_hours")
      .executeTakeFirst();

    return (row?.value as Record<string, unknown>) ?? {
      0: null, // Sunday
      1: { start: "09:00", end: "20:00" },
      2: { start: "09:00", end: "20:00" },
      3: { start: "09:00", end: "20:00" },
      4: { start: "09:00", end: "20:00" },
      5: { start: "09:00", end: "20:00" },
      6: { start: "10:00", end: "14:00" },
    };
  })

  .post("/working-hours", async ({ body }) => {
    await rootDb
      .insertInto("app_private.admin_settings")
      .values({ key: "working_hours", value: toJson(body) })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value: toJson(body) }))
      .execute();

    return { success: true as const };
  });

// === Download route (auth-only, not admin-only) ===
// This is a separate plugin because the download route only requires
// authentication, not admin role. Access control is in fileService.download.

export const materialDownloadRoute = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof HttpError) {
      set.status = error.status;
      return { error: error.message };
    }
  })
  .get("/api/materials/:id/download", async ({ params, cookie }) => {
    const token = cookie.session?.value as string | undefined;
    const result = await sessionService.validateSessionToken(token);
    if (!result) throw new HttpError(401, "Not authenticated");

    const fileInfo = await fileService.download(params.id, result.user.id);

    const bunFile = Bun.file(fileInfo.path);
    const stream = bunFile.stream();

    return new Response(stream, {
      headers: {
        "content-type": fileInfo.mimeType,
        "content-disposition": `attachment; filename="${encodeURIComponent(fileInfo.filename)}"`,
      },
    });
  });
