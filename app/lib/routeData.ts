import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { Effect, Option } from "effect";
import * as S from "effect/Schema";
import { PgRootDB, withAuthContext, type AuthKyselyDB, type KyselyDB } from "../../server/db.js";
import { HttpError } from "../../server/pgErrors.js";
import { serverRuntime } from "../../server/runtime.js";
import { SessionService } from "../../server/services/sessionService.js";
import {
  getTestimonialPromptEnabled,
  getTestimonialReminderIntervalDays,
} from "../../server/services/testimonialReminderService.js";
import * as SharedSchemas from "../../shared/schemas.js";
import type {
  AssignedMaterial,
  Lesson,
  LessonNote,
  Material,
  Message,
  Testimonial,
  User,
  UserEmail,
  WorkingHours,
} from "../../shared/schemas.js";

type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };

type QueryDb = KyselyDB | AuthKyselyDB;

type UserRecord = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  role: "admin" | "student" | "parent" | "teacher";
  is_verified: boolean;
};

const testimonialRoleLabels = {
  admin: "Admin",
  parent: "Parent",
  student: "Student",
  teacher: "Teacher",
} as const;

const defaultWorkingHours: WorkingHours = {
  0: null,
  1: { start: "09:00", end: "20:00" },
  2: { start: "09:00", end: "20:00" },
  3: { start: "09:00", end: "20:00" },
  4: { start: "09:00", end: "20:00" },
  5: { start: "09:00", end: "20:00" },
  6: { start: "10:00", end: "14:00" },
};

function runSync<A, E>(effect: Effect.Effect<A, E>): A {
  return Effect.runSync(effect);
}

function decodeRequired<A, I>(schema: S.Schema<A, I>, value: unknown): A {
  return runSync(Effect.sync(() => S.decodeUnknownSync(schema)(value)));
}

function decodeJsonValue<A, I>(
  schema: S.Schema<A, I>,
  value: JsonValue | null | undefined,
  fallback: A,
): A {
  if (value == null) {
    return fallback;
  }
  return runSync(
    Effect.try({
      try: () => S.decodeUnknownSync(schema)(value),
      catch: () => fallback,
    }),
  );
}

function toMutableArray<T>(items: readonly T[]): T[] {
  return [...items];
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoStringOrNull(value: Date | string | null): string | null {
  return value ? toIsoString(value) : null;
}

function decodeWorkingHoursValue(
  value: JsonValue | null | undefined,
  fallback: WorkingHours,
): WorkingHours {
  const decoded = decodeJsonValue(SharedSchemas.WorkingHours, value, fallback);
  return {
    0: decoded[0] ?? null,
    1: decoded[1] ?? null,
    2: decoded[2] ?? null,
    3: decoded[3] ?? null,
    4: decoded[4] ?? null,
    5: decoded[5] ?? null,
    6: decoded[6] ?? null,
  };
}

function serializeMaterial<
  T extends {
    notation_tracks: unknown;
  },
>(
  material: T,
): Omit<T, "notation_tracks"> & {
  notation_tracks: Material["notation_tracks"];
} {
  return {
    ...material,
    notation_tracks: decodeJsonValue(
      S.NullishOr(S.Array(SharedSchemas.MaterialNotationTrack)),
      material.notation_tracks as JsonValue | null | undefined,
      null,
    ),
  };
}

function serializeLesson(lesson: {
  id: string;
  student_id: string;
  gcal_event_id: string | null;
  scheduled_at: Date | string;
  duration_minutes: number;
  location_type: Lesson["location_type"];
  status: Lesson["status"];
  cancellation_reason: string | null;
  cancelled_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
}): Lesson {
  return decodeRequired(SharedSchemas.Lesson, {
    ...lesson,
    scheduled_at: toIsoString(lesson.scheduled_at),
    cancelled_at: toIsoStringOrNull(lesson.cancelled_at),
    completed_at: toIsoStringOrNull(lesson.completed_at),
    created_at: toIsoString(lesson.created_at),
  });
}

function serializeLessonNote(note: {
  id: string;
  lesson_id: string;
  topics_covered: string | null;
  homework: string | null;
  progress_observations: string | null;
  notes: string | null;
  material_ids: unknown;
  draft: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}): LessonNote {
  return decodeRequired(SharedSchemas.LessonNote, {
    ...note,
    material_ids: decodeJsonValue(
      S.NullishOr(S.Array(S.String)),
      note.material_ids as JsonValue | null | undefined,
      [],
    ),
    created_at: toIsoString(note.created_at),
    updated_at: toIsoString(note.updated_at),
  });
}

function serializeMessage(message: {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  is_read: boolean;
  created_at: Date | string;
}): Message {
  return decodeRequired(SharedSchemas.Message, {
    ...message,
    created_at: toIsoString(message.created_at),
  });
}

function serializeUserEmail(email: {
  id: string;
  email: string;
  is_verified: boolean;
  is_primary: boolean;
  created_at: Date | string;
}): UserEmail {
  return decodeRequired(SharedSchemas.UserEmail, {
    ...email,
    created_at: toIsoString(email.created_at),
  });
}

function serializeTestimonial(testimonial: {
  id: string;
  user_id: string;
  body: string;
  is_approved: boolean;
  username: string;
  name: string | null;
  role: "admin" | "student" | "parent" | "teacher";
  created_at: Date | string;
  updated_at: Date | string;
}): Testimonial {
  return decodeRequired(SharedSchemas.Testimonial, {
    id: testimonial.id,
    user_id: testimonial.user_id,
    body: testimonial.body,
    display_name: testimonial.name?.trim() || testimonial.username,
    role_label: testimonialRoleLabels[testimonial.role],
    is_approved: testimonial.is_approved,
    created_at: toIsoString(testimonial.created_at),
    updated_at: toIsoString(testimonial.updated_at),
  });
}

function studentSummarySelect(db: KyselyDB) {
  return db
    .selectFrom("app_public.users")
    .select(["id", "username", "name", "role", "is_verified"])
    .select((eb) =>
      eb
        .selectFrom("app_public.user_emails")
        .select("email")
        .whereRef("app_public.user_emails.user_id", "=", "app_public.users.id")
        .where("is_primary", "=", true)
        .limit(1)
        .as("email"),
    )
    .where("role", "=", "student");
}

function lessonsSelect(
  db: QueryDb,
  options?: {
    limit?: number;
    from?: string;
    to?: string;
    status?: Lesson["status"];
  },
) {
  let query = db
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
    .orderBy("scheduled_at", "desc");
  if (options?.from) {
    query = query.where("scheduled_at", ">=", new Date(options.from));
  }
  if (options?.to) {
    query = query.where("scheduled_at", "<=", new Date(options.to));
  }
  if (options?.status) {
    query = query.where("status", "=", options.status);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  return query;
}

function messagesSelect(db: QueryDb) {
  return db
    .selectFrom("app_public.messages")
    .select([
      "id",
      "sender_id",
      "recipient_id",
      "body",
      "is_read",
      "created_at",
    ])
    .orderBy("created_at", "desc")
    .limit(50);
}

function assignmentsSelect(db: QueryDb) {
  return db
    .selectFrom("app_public.student_materials as sm")
    .innerJoin("app_public.materials as m", "m.id", "sm.material_id")
    .select([
      "m.id",
      "m.title",
      "m.original_filename",
      "m.mime_type",
      "m.file_size",
      "m.is_global",
      "m.notation_tracks",
      "sm.assigned_track_index",
    ]);
}

function coursesSelect(db: QueryDb) {
  return db
    .selectFrom("app_public.courses")
    .select(["id", "title", "description", "instrument"]);
}

function testimonialsSelect(
  db: QueryDb,
  options?: {
    userId?: string;
    limit?: number;
    approvedOnly?: boolean;
    pendingFirst?: boolean;
  },
) {
  let query = db
    .selectFrom("app_public.testimonials as t")
    .innerJoin("app_public.users as u", "u.id", "t.user_id")
    .select([
      "t.id",
      "t.user_id",
      "t.body",
      "t.is_approved",
      "t.created_at",
      "t.updated_at",
      "u.username",
      "u.name",
      "u.role",
    ])
    .where("u.role", "!=", "admin");
  if (options?.userId) {
    query = query.where("t.user_id", "=", options.userId);
  }
  if (options?.approvedOnly) {
    query = query.where("t.is_approved", "=", true);
  }
  if (options?.pendingFirst) {
    query = query.orderBy("t.is_approved", "asc");
  }
  query = query.orderBy("t.updated_at", "desc");
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  return query;
}

function normalizeStudents(rows: UserRecord[]): User[] {
  return rows.map((student) =>
    decodeRequired(SharedSchemas.User, {
      ...student,
      name: student.name ?? "",
      email: student.email ?? "",
    }),
  );
}

function todayRange() {
  const todayStr = new Date().toISOString().slice(0, 10);
  return {
    from: `${todayStr}T00:00:00.000Z`,
    to: `${todayStr}T23:59:59.999Z`,
  };
}

function weekRange() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    from: `${monday.toISOString().slice(0, 10)}T00:00:00.000Z`,
    to: `${sunday.toISOString().slice(0, 10)}T23:59:59.999Z`,
  };
}

async function getRootDb() {
  return serverRuntime.runPromise(
    Effect.gen(function* () {
      return yield* PgRootDB;
    }),
  );
}

async function requireSession() {
  const token = getCookie("session");
  const session = await serverRuntime.runPromise(
    SessionService.validateSessionToken(token),
  );
  if (!session) {
    throw HttpError.make(401, "Unauthorized");
  }
  return session;
}

async function requireAdminSession() {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    throw HttpError.make(403, "Forbidden");
  }
  return session;
}

export const getSettingsPageData = createServerFn({ method: "GET" }).handler(
  async () => {
    const session = await requireSession();

    const emailsPromise = serverRuntime.runPromise(
      withAuthContext(session.session.id, (db) =>
        db
          .selectFrom("app_public.user_emails")
          .select(["id", "email", "is_verified", "is_primary", "created_at"])
          .orderBy("is_primary", "desc")
          .orderBy("created_at", "asc"),
      ),
    );

    if (session.user.role !== "admin") {
      const [emails, testimonials] = await Promise.all([
        emailsPromise,
        serverRuntime.runPromise(
          withAuthContext(session.session.id, (db) =>
            testimonialsSelect(db, {
              userId: session.user.id,
            }).pipe(Effect.head, Effect.option),
          ),
        ),
      ]);

      return {
        emails: emails.map(serializeUserEmail),
        testimonial: Option.match(testimonials, {
          onNone: () => null,
          onSome: serializeTestimonial,
        }),
        gcalStatus: null,
        workingHours: null,
        testimonialReminderIntervalDays: null,
        adminTestimonials: null,
      };
    }

    const rootDb = await getRootDb();
    const [emails, tokenRows, calIdRows, workingHoursRows, intervalDays, adminTestimonials] =
      await Promise.all([
        emailsPromise,
        serverRuntime.runPromise(
          rootDb
            .selectFrom("app_private.admin_settings")
            .select("value")
            .where("key", "=", "gcal_refresh_token")
            .pipe(Effect.head, Effect.option),
        ),
        serverRuntime.runPromise(
          rootDb
            .selectFrom("app_private.admin_settings")
            .select("value")
            .where("key", "=", "gcal_calendar_id")
            .pipe(Effect.head, Effect.option),
        ),
        serverRuntime.runPromise(
          rootDb
            .selectFrom("app_private.admin_settings")
            .select("value")
            .where("key", "=", "working_hours")
            .pipe(Effect.head, Effect.option),
        ),
        serverRuntime.runPromise(getTestimonialReminderIntervalDays()),
        serverRuntime.runPromise(testimonialsSelect(rootDb, { pendingFirst: true })),
      ]);

    return {
      emails: emails.map(serializeUserEmail),
      testimonial: null,
      gcalStatus: decodeRequired(SharedSchemas.GcalStatus, {
        connected: Option.isSome(tokenRows),
        calendar_id: decodeJsonValue(
          S.NullishOr(S.String),
          (Option.getOrNull(calIdRows)?.value as JsonValue | null | undefined) ?? null,
          null,
        ),
      }),
      workingHours: decodeWorkingHoursValue(
        (Option.getOrNull(workingHoursRows)?.value as JsonValue | null | undefined) ??
          null,
        defaultWorkingHours,
      ),
      testimonialReminderIntervalDays: intervalDays,
      adminTestimonials: adminTestimonials.map(serializeTestimonial),
    };
  },
);

export const getLessonsPageData = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireAdminSession();
    const rootDb = await getRootDb();
    const [lessons, students] = await Promise.all([
      serverRuntime.runPromise(lessonsSelect(rootDb, { limit: 50 })),
      serverRuntime.runPromise(studentSummarySelect(rootDb)),
    ]);

    return {
      lessons: lessons.map(serializeLesson),
      students: normalizeStudents(students),
    };
  },
);

export const getLessonNote = createServerFn({ method: "GET" })
  .inputValidator((input: { lessonId: string }) => input)
  .handler(async ({ data }) => {
    await requireAdminSession();
    const rootDb = await getRootDb();
    const note = await serverRuntime.runPromise(
      rootDb
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
        .where("lesson_id", "=", data.lessonId)
        .pipe(Effect.head, Effect.option),
    );
    if (Option.isNone(note)) {
      throw HttpError.make(404, "Lesson note not found");
    }
    return serializeLessonNote(note.value);
  });

export const getDashboardPageData = createServerFn({ method: "GET" }).handler(
  async () => {
    const session = await requireSession();

    if (session.user.role === "admin") {
      const rootDb = await getRootDb();
      const today = todayRange();
      const week = weekRange();
      const [students, messages, todayLessons, weekLessons, courses] = await Promise.all([
        serverRuntime.runPromise(studentSummarySelect(rootDb)),
        serverRuntime.runPromise(messagesSelect(rootDb)),
        serverRuntime.runPromise(lessonsSelect(rootDb, { from: today.from, to: today.to })),
        serverRuntime.runPromise(lessonsSelect(rootDb, { from: week.from, to: week.to })),
        serverRuntime.runPromise(coursesSelect(rootDb)),
      ]);

      return {
        kind: "admin" as const,
        students: normalizeStudents(students),
        messages: messages.map(serializeMessage),
        todayLessons: todayLessons.map(serializeLesson),
        weekLessons: weekLessons.map(serializeLesson),
        courses: toMutableArray(
          decodeRequired(S.Array(SharedSchemas.Course), courses),
        ),
      };
    }

    const [data, canShowTestimonialPrompt] = await Promise.all([
      serverRuntime.runPromise(
        withAuthContext(session.session.id, (db) =>
          Effect.all({
            messages: messagesSelect(db),
            assignments: assignmentsSelect(db),
            scheduledLessons: lessonsSelect(db, { status: "scheduled", limit: 5 }),
            courses: coursesSelect(db),
            testimonial: testimonialsSelect(db, {
              userId: session.user.id,
            }).pipe(Effect.head, Effect.option),
          }),
        ),
      ),
      serverRuntime.runPromise(getTestimonialPromptEnabled(session.user.id)),
    ]);

    return {
      kind: "student" as const,
      messages: data.messages.map(serializeMessage),
      assignments: data.assignments.map((assignment) =>
        serializeMaterial(assignment),
      ) as AssignedMaterial[],
      scheduledLessons: data.scheduledLessons.map(serializeLesson),
      courses: toMutableArray(
        decodeRequired(S.Array(SharedSchemas.Course), data.courses),
      ),
      testimonial: Option.match(data.testimonial, {
        onNone: () => null,
        onSome: serializeTestimonial,
      }),
      canShowTestimonialPrompt,
    };
  },
);

export const getHomePageData = createServerFn({ method: "GET" }).handler(
  async () => {
    const rootDb = await getRootDb();
    const rows = await serverRuntime.runPromise(
      testimonialsSelect(rootDb, {
        limit: 6,
        approvedOnly: true,
      }),
    );
    return {
      testimonials: rows.map(serializeTestimonial),
    };
  },
);
