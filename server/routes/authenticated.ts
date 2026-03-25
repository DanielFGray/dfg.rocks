import Elysia, { t } from "elysia";
import { sql } from "kysely";
import { sessionService, type SessionResult } from "../services/sessionService.js";
import { googleCalendarService } from "../services/googleCalendarService.js";
import { rootDb, withAuthContext } from "../db.js";
import { HttpError, mapPgError } from "../pgErrors.js";

// === Helpers ===

function csrfCheck(headers: Record<string, string | undefined>): void {
  if (!headers["x-requested-with"]) {
    throw new HttpError(400, "Missing CSRF header");
  }
}

function expireSessionCookie(cookie: { session: { remove: () => void } }): void {
  cookie.session.remove();
}

// === Plugin ===

export const authenticatedRoutes = new Elysia({ prefix: "/api" })
  .onError(({ error, set }) => {
    if (error instanceof HttpError) {
      set.status = error.status;
      return { error: error.message };
    }
  })
  .derive(async ({ cookie }) => {
    const token = cookie.session?.value;
    const result = await sessionService.validateSessionToken(token);
    if (!result) throw new HttpError(401, "Unauthorized");
    return { auth: result as NonNullable<SessionResult> };
  })

  // --- Courses ---

  .get("/courses", ({ auth }) =>
    withAuthContext(auth.session.id, (db) =>
      db
        .selectFrom("app_public.courses")
        .select(["id", "title", "description", "instrument"])
        .execute(),
    ),
  )

  .get("/courses/:id", ({ auth, params }) =>
    withAuthContext(auth.session.id, async (db) => {
      const course = await db
        .selectFrom("app_public.courses")
        .select(["id", "title", "description", "instrument"])
        .where("id", "=", params.id)
        .executeTakeFirst();

      if (!course) throw new HttpError(404, "Course not found");

      const modules = await db
        .selectFrom("app_public.modules")
        .select(["id", "course_id", "title", "description", "sort_order"])
        .where("course_id", "=", params.id)
        .orderBy("sort_order")
        .execute();

      const modulesWithMaterials = await Promise.all(
        modules.map(async (mod) => {
          const materials = await db
            .selectFrom("app_public.module_materials as mm")
            .innerJoin("app_public.materials as mat", "mat.id", "mm.material_id")
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
            .execute();
          return { ...mod, materials };
        }),
      );

      return { ...course, modules: modulesWithMaterials };
    }),
  )

  // --- Library ---

  .get("/library", ({ auth, query }) =>
    withAuthContext(auth.session.id, (db) =>
      db
        .selectFrom("app_public.materials")
        .select(["id", "title", "original_filename", "mime_type", "file_size", "is_global"])
        .limit(query.limit ?? 50)
        .offset(query.offset ?? 0)
        .execute(),
    ),
    {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
    },
  )

  // --- Assignments ---

  .get("/assignments", ({ auth }) =>
    withAuthContext(auth.session.id, (db) =>
      db
        .selectFrom("app_public.student_materials as sm")
        .innerJoin("app_public.materials as m", "m.id", "sm.material_id")
        .select([
          "m.id",
          "m.title",
          "m.original_filename",
          "m.mime_type",
          "m.file_size",
          "m.is_global",
        ])
        .execute(),
    ),
  )

  // --- Practice Logs ---

  .get("/practice-logs", ({ auth, query }) =>
    withAuthContext(auth.session.id, async (db) => {
      let q = db
        .selectFrom("app_public.practice_logs")
        .selectAll()
        .orderBy("logged_at", "desc");

      if (query.material_id) {
        q = q.where("material_id", "=", query.material_id);
      }

      const rows = await q.execute();
      return rows.map((r) => ({ ...r, logged_at: (r.logged_at as Date).toISOString() }));
    }),
    {
      query: t.Object({
        material_id: t.Optional(t.String()),
      }),
    },
  )

  .post("/practice-logs", ({ auth, body }) =>
    withAuthContext(auth.session.id, async (db) => {
      const row = await db
        .insertInto("app_public.practice_logs")
        .values({
          student_id: auth.user.id,
          material_id: body.material_id,
          status: body.status,
          notes: body.notes ?? null,
        })
        .returning(["id", "student_id", "material_id", "status", "notes", "logged_at"])
        .executeTakeFirstOrThrow();
      return { ...row, logged_at: (row.logged_at as Date).toISOString() };
    }),
    {
      body: t.Object({
        material_id: t.String(),
        status: t.Union([t.Literal("practiced"), t.Literal("completed")]),
        notes: t.Optional(t.String()),
      }),
    },
  )

  // --- Assignment Notes ---

  .get("/assignments/:materialId/notes", ({ auth, params }) =>
    withAuthContext(auth.session.id, async (db) => {
      const row = await db
        .selectFrom("app_public.assignment_notes")
        .selectAll()
        .where("material_id", "=", params.materialId)
        .executeTakeFirst();

      if (!row) return null;
      return {
        ...row,
        created_at: (row.created_at as Date).toISOString(),
        updated_at: (row.updated_at as Date).toISOString(),
      };
    }),
  )

  .put("/assignments/:materialId/notes", ({ auth, params, body }) =>
    withAuthContext(auth.session.id, async (db) => {
      const row = await db
        .insertInto("app_public.assignment_notes")
        .values({
          student_id: auth.user.id,
          material_id: params.materialId,
          body: body.body,
        })
        .onConflict((oc) =>
          oc.columns(["student_id", "material_id"]).doUpdateSet({
            body: body.body,
            updated_at: new Date(),
          }),
        )
        .returning(["id", "student_id", "material_id", "body", "created_at", "updated_at"])
        .executeTakeFirstOrThrow();
      return {
        ...row,
        created_at: (row.created_at as Date).toISOString(),
        updated_at: (row.updated_at as Date).toISOString(),
      };
    }),
    {
      body: t.Object({
        body: t.String(),
      }),
    },
  )

  // --- Messages ---

  .get("/messages", ({ auth, query }) =>
    withAuthContext(auth.session.id, async (db) => {
      let q = db
        .selectFrom("app_public.messages")
        .selectAll()
        .orderBy("created_at", "desc")
        .limit(query.limit ?? 50)
        .offset(query.offset ?? 0);

      if (query.with) {
        q = q.where((eb) =>
          eb.or([
            eb("sender_id", "=", query.with!),
            eb("recipient_id", "=", query.with!),
          ]),
        );
      }

      const rows = await q.execute();
      return rows.map((r) => ({ ...r, created_at: (r.created_at as Date).toISOString() }));
    }),
    {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
        with: t.Optional(t.String()),
      }),
    },
  )

  .post("/messages", async ({ auth, body }) => {
    // Resolve recipient: if not provided, send to the admin
    let recipientId = body.recipient_id;
    if (!recipientId) {
      const admin = await rootDb
        .selectFrom("app_public.users")
        .select("id")
        .where("role", "=", "admin")
        .limit(1)
        .executeTakeFirst();
      if (!admin) throw new HttpError(400, "No admin user found");
      recipientId = admin.id;
    }

    return withAuthContext(auth.session.id, async (db) => {
      const row = await db
        .insertInto("app_public.messages")
        .values({
          sender_id: auth.user.id,
          recipient_id: recipientId,
          body: body.body,
        })
        .returning(["id", "sender_id", "recipient_id", "body", "is_read", "created_at"])
        .executeTakeFirstOrThrow();
      return { ...row, created_at: (row.created_at as Date).toISOString() };
    });
  },
    {
      body: t.Object({
        recipient_id: t.Optional(t.String()),
        body: t.String(),
      }),
    },
  )

  .patch("/messages/:id", ({ auth, params }) =>
    withAuthContext(auth.session.id, async (db) => {
      await db
        .updateTable("app_public.messages")
        .set({ is_read: true })
        .where("id", "=", params.id)
        .execute();
      return { success: true as const };
    }),
  )

  // --- My Lessons ---

  .get("/my-lessons", ({ auth, query }) =>
    withAuthContext(auth.session.id, async (db) => {
      let q = db
        .selectFrom("app_public.lessons")
        .select([
          "id",
          "student_id",
          "gcal_event_id",
          "scheduled_at",
          "duration_minutes",
          "location_type",
          "status",
          "cancellation_reason",
          "cancelled_at",
          "completed_at",
          "created_at",
        ])
        .orderBy("scheduled_at", "desc")
        .limit(query.limit ?? 50)
        .offset(query.offset ?? 0);

      if (query.status) q = q.where("status", "=", query.status as "scheduled");
      if (query.from) q = q.where("scheduled_at", ">=", new Date(query.from));
      if (query.to) q = q.where("scheduled_at", "<=", new Date(query.to));

      const rows = await q.execute();
      return rows.map((r) => ({
        ...r,
        scheduled_at: (r.scheduled_at as Date).toISOString(),
        cancelled_at: r.cancelled_at ? (r.cancelled_at as Date).toISOString() : null,
        completed_at: r.completed_at ? (r.completed_at as Date).toISOString() : null,
        created_at: (r.created_at as Date).toISOString(),
      }));
    }),
    {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
        status: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
      }),
    },
  )

  .get("/my-lessons/:id", ({ auth, params }) =>
    withAuthContext(auth.session.id, async (db) => {
      const row = await db
        .selectFrom("app_public.lessons")
        .select([
          "id",
          "student_id",
          "gcal_event_id",
          "scheduled_at",
          "duration_minutes",
          "location_type",
          "status",
          "cancellation_reason",
          "cancelled_at",
          "completed_at",
          "created_at",
        ])
        .where("id", "=", params.id)
        .executeTakeFirst();

      if (!row) throw new HttpError(404, "Lesson not found");

      return {
        ...row,
        scheduled_at: (row.scheduled_at as Date).toISOString(),
        cancelled_at: row.cancelled_at ? (row.cancelled_at as Date).toISOString() : null,
        completed_at: row.completed_at ? (row.completed_at as Date).toISOString() : null,
        created_at: (row.created_at as Date).toISOString(),
      };
    }),
  )

  // --- Account Deletion ---

  .post("/request-delete-account", ({ auth, headers }) => {
    csrfCheck(headers);
    return withAuthContext(auth.session.id, async (db) => {
      await sql`select app_public.request_account_deletion()`.execute(db);
      return { success: true as const };
    });
  })

  .post("/confirm-delete-account", async ({ auth, headers, body, cookie }) => {
    csrfCheck(headers);

    const result = await withAuthContext(auth.session.id, (db) =>
      db
        .selectNoFrom((eb) =>
          eb
            .fn<boolean>("app_public.confirm_account_deletion", [eb.val(body.token)])
            .as("confirm_account_deletion"),
        )
        .executeTakeFirst(),
    );

    if (!result?.confirm_account_deletion) {
      throw new HttpError(400, "Invalid or expired deletion token");
    }

    // Account deleted -- clean up sessions and cookie
    await sessionService.deleteAllUserSessionsFromCache(auth.user.id);
    expireSessionCookie(cookie);
    return { success: true as const };
  },
    {
      body: t.Object({
        token: t.String(),
      }),
    },
  )

  // --- Lesson Notes (student view) ---

  .get("/my-lessons/:id/notes", ({ auth, params }) =>
    withAuthContext(auth.session.id, async (db) => {
      const row = await db
        .selectFrom("app_public.lesson_notes")
        .select([
          "id",
          "lesson_id",
          "topics_covered",
          "homework",
          "progress_observations",
          "notes",
          "material_ids",
          "draft",
          "created_at",
          "updated_at",
        ])
        .where("lesson_id", "=", params.id)
        .executeTakeFirst();

      if (!row) throw new HttpError(404, "Lesson note not found");

      return {
        ...row,
        material_ids: (row.material_ids ?? null) as string[] | null,
        created_at: (row.created_at as Date).toISOString(),
        updated_at: (row.updated_at as Date).toISOString(),
      };
    }),
  )

  .get("/my-lesson-notes", ({ auth, query }) =>
    withAuthContext(auth.session.id, async (db) => {
      const rows = await db
        .selectFrom("app_public.lesson_notes as ln")
        .innerJoin("app_public.lessons as l", "l.id", "ln.lesson_id")
        .select([
          "ln.id",
          "ln.lesson_id",
          "ln.topics_covered",
          "ln.homework",
          "ln.progress_observations",
          "ln.notes",
          "ln.material_ids",
          "ln.draft",
          "ln.created_at",
          "ln.updated_at",
        ])
        .orderBy("l.scheduled_at", "desc")
        .limit(query.limit ?? 50)
        .offset(query.offset ?? 0)
        .execute();

      return rows.map((r) => ({
        ...r,
        material_ids: (r.material_ids ?? null) as string[] | null,
        created_at: (r.created_at as Date).toISOString(),
        updated_at: (r.updated_at as Date).toISOString(),
      }));
    }),
    {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
    },
  )

  // --- Email Management ---

  .get("/me/emails", ({ auth }) =>
    withAuthContext(auth.session.id, async (db) => {
      const rows = await db
        .selectFrom("app_public.user_emails")
        .select(["id", "email", "is_verified", "is_primary", "created_at"])
        .orderBy("is_primary", "desc")
        .orderBy("created_at", "asc")
        .execute();

      return rows.map((r) => ({
        ...r,
        created_at: (r.created_at as Date).toISOString(),
      }));
    }),
  )

  .post("/me/emails", ({ auth, body }) =>
    withAuthContext(auth.session.id, async (db) => {
      try {
        const row = await db
          .insertInto("app_public.user_emails")
          .values({ user_id: auth.user.id, email: body.email })
          .returning(["id", "email", "is_verified", "is_primary", "created_at"])
          .executeTakeFirstOrThrow();
        return {
          ...row,
          created_at: (row.created_at as Date).toISOString(),
        };
      } catch (err) {
        mapPgError(err);
      }
    }),
    {
      body: t.Object({
        email: t.String(),
      }),
    },
  )

  .delete("/me/emails/:id", ({ auth, params }) =>
    withAuthContext(auth.session.id, async (db) => {
      // Check email exists and belongs to user (via RLS), and check primary explicitly
      const email = await db
        .selectFrom("app_public.user_emails")
        .select(["id", "is_primary"])
        .where("id", "=", params.id)
        .executeTakeFirst();

      if (!email) throw new HttpError(404, "Email not found");
      if (email.is_primary) throw new HttpError(400, "Cannot delete primary email");

      await db
        .deleteFrom("app_public.user_emails")
        .where("id", "=", params.id)
        .execute();

      return { success: true as const };
    }),
  )

  .post("/me/emails/:id/make-primary", ({ auth, params }) =>
    withAuthContext(auth.session.id, async (db) => {
      // Verify email belongs to current user via RLS
      const email = await db
        .selectFrom("app_public.user_emails")
        .select(["id"])
        .where("id", "=", params.id)
        .executeTakeFirst();

      if (!email) throw new HttpError(404, "Email not found");

      // Call SECURITY DEFINER function in auth context
      await sql`select app_public.make_email_primary(${params.id}::uuid)`.execute(db);

      // Fetch updated record
      const updated = await db
        .selectFrom("app_public.user_emails")
        .select(["id", "email", "is_verified", "is_primary", "created_at"])
        .where("id", "=", params.id)
        .executeTakeFirst();

      if (!updated) throw new HttpError(404, "Email not found");

      return {
        ...updated,
        created_at: (updated.created_at as Date).toISOString(),
      };
    }),
  )

  .post("/me/emails/:id/resend-verification", ({ auth, params }) =>
    withAuthContext(auth.session.id, async (db) => {
      // Check email exists, belongs to user, and is not verified
      const email = await db
        .selectFrom("app_public.user_emails")
        .select(["id", "is_verified"])
        .where("id", "=", params.id)
        .executeTakeFirst();

      if (!email) throw new HttpError(404, "Email not found");
      if (email.is_verified) throw new HttpError(400, "Email is already verified");

      await sql`select app_public.resend_email_verification_code(${params.id}::uuid)`.execute(db);

      return { success: true as const };
    }),
  )

  // --- Available Slots ---

  .get("/available-slots", async ({ query }) =>
    googleCalendarService.getAvailableSlots({
      date: query.date,
      days: query.days ?? 7,
      duration: query.duration ?? 60,
    }),
    {
      query: t.Object({
        date: t.String(),
        days: t.Optional(t.Numeric()),
        duration: t.Optional(t.Numeric()),
      }),
    },
  )

  // --- Book Lesson ---

  .post("/my-lessons/book", async ({ auth, body }) => {
    const scheduledAt = new Date(body.scheduled_at);
    const slotEnd = new Date(scheduledAt.getTime() + body.duration_minutes * 60000);

    // 1. Check for overlapping scheduled lessons
    const overlapping = await rootDb
      .selectFrom("app_public.lessons")
      .select("id")
      .where("status", "=", "scheduled")
      .where("scheduled_at", "<", slotEnd)
      .where(sql`scheduled_at + (duration_minutes || ' minutes')::interval`, ">", scheduledAt)
      .execute();

    if (overlapping.length > 0) {
      throw new HttpError(400, "This time slot is no longer available");
    }

    // 2. Look up student's rate for this location type
    const rate = await rootDb
      .selectFrom("app_public.student_rates")
      .select(["rate_cents", "lesson_duration_minutes"])
      .where("student_id", "=", auth.user.id)
      .where("location_type", "=", body.location_type)
      .executeTakeFirst();

    if (!rate) {
      throw new HttpError(404, "No rate configured for this location type. Please contact your teacher.");
    }

    // 3. Create the lesson
    const lesson = await rootDb
      .insertInto("app_public.lessons")
      .values({
        student_id: auth.user.id,
        scheduled_at: scheduledAt,
        duration_minutes: body.duration_minutes,
        location_type: body.location_type,
        status: "scheduled",
      })
      .returning([
        "id",
        "student_id",
        "gcal_event_id",
        "scheduled_at",
        "duration_minutes",
        "location_type",
        "status",
        "cancellation_reason",
        "cancelled_at",
        "completed_at",
        "created_at",
      ])
      .executeTakeFirstOrThrow();

    // 4. Create deposit (1/3 of lesson price, rounded up)
    const depositAmount = Math.ceil(rate.rate_cents / 3);
    await rootDb
      .insertInto("app_public.lesson_deposits")
      .values({
        lesson_id: lesson.id,
        amount_cents: depositAmount,
        status: "held",
      })
      .execute();

    // 5. Best-effort gcal event creation
    const connected = await googleCalendarService.isConnected();
    if (connected) {
      try {
        const studentName = auth.user.name || "Student";
        const eventId = await googleCalendarService.createEvent({
          summary: `Lesson: ${studentName}`,
          description: `${body.duration_minutes} min ${body.location_type.replace(/_/g, " ")} lesson`,
          start: scheduledAt.toISOString(),
          end: slotEnd.toISOString(),
        });

        if (eventId) {
          await rootDb
            .updateTable("app_public.lessons")
            .set({ gcal_event_id: eventId })
            .where("id", "=", lesson.id)
            .execute();
        }
      } catch {
        // best-effort -- swallow gcal errors
      }
    }

    // Re-fetch to get potentially updated gcal_event_id
    const updated =
      (await rootDb
        .selectFrom("app_public.lessons")
        .select([
          "id",
          "student_id",
          "gcal_event_id",
          "scheduled_at",
          "duration_minutes",
          "location_type",
          "status",
          "cancellation_reason",
          "cancelled_at",
          "completed_at",
          "created_at",
        ])
        .where("id", "=", lesson.id)
        .executeTakeFirst()) ?? lesson;

    return {
      ...updated,
      scheduled_at: (updated.scheduled_at as Date).toISOString(),
      cancelled_at: updated.cancelled_at ? (updated.cancelled_at as Date).toISOString() : null,
      completed_at: updated.completed_at ? (updated.completed_at as Date).toISOString() : null,
      created_at: (updated.created_at as Date).toISOString(),
    };
  },
    {
      body: t.Object({
        scheduled_at: t.String(),
        duration_minutes: t.Number(),
        location_type: t.Union([
          t.Literal("in_person_teacher_travels"),
          t.Literal("in_person_student_travels"),
          t.Literal("studio"),
          t.Literal("online"),
        ]),
      }),
    },
  );
