import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { sql } from "kysely";
import { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/postgres";
import { rootDb, withAuthContext } from "../../server/db.js";
import { HttpError } from "../../server/pgErrors.js";
import { googleCalendarService } from "../../server/services/googleCalendarService.js";
import { sessionService } from "../../server/services/sessionService.js";
import {
  getTestimonialPromptEnabled,
  getTestimonialReminderIntervalDays,
} from "../../server/services/testimonialReminderService.js";
import type {
  AssignedMaterial,
  AssignmentNote,
  AssignmentProgress,
  AssignmentReview,
  Course,
  Family,
  GcalStatus,
  Lesson,
  LessonNote,
  Material,
  Message,
  StudentDetail,
  Submission,
  Testimonial,
  UserEmail,
  WorkingHours,
} from "./types.js";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function parseJsonValue<T>(value: JsonValue | null | undefined, fallback: T): T {
  return (value as T | null | undefined) ?? fallback;
}

function serializeMaterial<T extends { notation_tracks: unknown }>(
  material: T,
): Omit<T, "notation_tracks"> & {
  notation_tracks: Material["notation_tracks"];
} {
  return {
    ...material,
    notation_tracks: (material.notation_tracks ?? null) as Material["notation_tracks"],
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoStringOrNull(value: Date | string | null): string | null {
  return value ? toIsoString(value) : null;
}

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

async function requireSession() {
  const token = getCookie("session");
  const session = await sessionService.validateSessionToken(token);

  if (!session) {
    throw new HttpError(401, "Unauthorized");
  }

  return session;
}

async function requireAdminSession() {
  const session = await requireSession();

  if (session.user.role !== "admin") {
    throw new HttpError(403, "Forbidden");
  }

  return session;
}

async function requireStaffSession() {
  const session = await requireSession();

  if (session.user.role !== "admin" && session.user.role !== "teacher") {
    throw new HttpError(403, "Forbidden");
  }

  return session;
}

function serializeAssignmentProgress(progress: {
  material_id: string;
  listened_seconds: number;
  updated_at: Date | string;
}): AssignmentProgress {
  return {
    ...progress,
    updated_at: toIsoString(progress.updated_at),
  };
}

function serializeAssignmentReview(review: {
  id: string;
  material_id: string;
  stars: number;
  listened_seconds: number;
  created_at: Date | string;
}): AssignmentReview {
  return {
    ...review,
    created_at: toIsoString(review.created_at),
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
  return {
    ...lesson,
    scheduled_at: toIsoString(lesson.scheduled_at),
    cancelled_at: toIsoStringOrNull(lesson.cancelled_at),
    completed_at: toIsoStringOrNull(lesson.completed_at),
    created_at: toIsoString(lesson.created_at),
  };
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
  return {
    ...note,
    material_ids: parseJsonValue<string[] | null>(note.material_ids as JsonValue | null, null),
    created_at: toIsoString(note.created_at),
    updated_at: toIsoString(note.updated_at),
  };
}

function serializeTestimonial(testimonial: {
  id: string;
  user_id: string;
  body: string;
  username: string;
  name: string | null;
  role: "admin" | "student" | "parent" | "teacher";
  created_at: Date | string;
  updated_at: Date | string;
}): Testimonial {
  return {
    id: testimonial.id,
    user_id: testimonial.user_id,
    body: testimonial.body,
    display_name: testimonial.name?.trim() || testimonial.username,
    role_label: testimonialRoleLabels[testimonial.role],
    created_at: toIsoString(testimonial.created_at),
    updated_at: toIsoString(testimonial.updated_at),
  };
}

function studentSummarySelect(db: typeof rootDb) {
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
  db: typeof rootDb,
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

function messagesSelect(db: typeof rootDb) {
  return db
    .selectFrom("app_public.messages")
    .select(["id", "sender_id", "recipient_id", "body", "is_read", "created_at"])
    .orderBy("created_at", "desc")
    .limit(50);
}

function assignmentsSelect(db: typeof rootDb) {
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

function coursesSelect(db: typeof rootDb) {
  return db.selectFrom("app_public.courses").select(["id", "title", "description", "instrument"]);
}

function testimonialsSelect(db: typeof rootDb, options?: { userId?: string; limit?: number }) {
  let query = db
    .selectFrom("app_public.testimonials as t")
    .innerJoin("app_public.users as u", "u.id", "t.user_id")
    .select([
      "t.id",
      "t.user_id",
      "t.body",
      "t.created_at",
      "t.updated_at",
      "u.username",
      "u.name",
      "u.role",
    ])
    .where("u.role", "!=", "admin")
    .orderBy("t.updated_at", "desc");

  if (options?.userId) {
    query = query.where("t.user_id", "=", options.userId);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }

  return query;
}

type DashboardAdminData = {
  kind: "admin";
  students: UserRecord[];
  messages: Message[];
  todayLessons: Lesson[];
  weekLessons: Lesson[];
};

type DashboardStudentData = {
  kind: "student";
  messages: Message[];
  assignments: Material[];
  scheduledLessons: Lesson[];
  courses: Course[];
  testimonial: Testimonial | null;
  canShowTestimonialPrompt: boolean;
};

type AssignmentsStudentData = {
  kind: "student";
  materials: AssignedMaterial[];
  progress: AssignmentProgress[];
  reviews: AssignmentReview[];
};

type AssignmentsStaffMaterial = AssignedMaterial & {
  listened_seconds: number;
};

type AssignmentsStaffStudent = {
  id: string;
  username: string;
  name: string;
  email: string;
  assigned_materials: AssignmentsStaffMaterial[];
};

type AssignmentsStaffData = {
  kind: "staff";
  students: AssignmentsStaffStudent[];
  allMaterials: Material[];
};

type UserRecord = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  role: "admin" | "student" | "parent" | "teacher";
  is_verified: boolean;
};

type MessageRecord = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  is_read: boolean;
  created_at: Date | string;
};

function normalizeStudents(rows: UserRecord[]) {
  return rows.map((student) => ({
    ...student,
    name: student.name ?? "",
    email: student.email ?? "",
  }));
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

export const getInvitationData = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string; code: string }) => input)
  .handler(async ({ data }) => {
    const invitation = await rootDb
      .selectFrom("app_public.family_invitations")
      .select(["family_id", "code", "email", "expires_at"])
      .where("id", "=", data.id)
      .executeTakeFirst();

    if (!invitation) {
      throw new HttpError(404, "Invitation not found");
    }

    if (invitation.code && invitation.code !== data.code) {
      throw new HttpError(404, "Invalid invitation code");
    }

    if (invitation.expires_at && invitation.expires_at < new Date()) {
      throw new HttpError(400, "This invitation has expired");
    }

    const family = await rootDb
      .selectFrom("app_public.families")
      .select(["id", "slug", "name", "description", "created_at"])
      .where("id", "=", invitation.family_id)
      .executeTakeFirstOrThrow();

    return {
      ...family,
      created_at: family.created_at.toISOString(),
      email: invitation.email ?? "",
    };
  });

export const getSubmissionsPageData = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminSession();

  const rows = await rootDb
    .selectFrom("app_public.contact_submissions")
    .selectAll()
    .orderBy("created_at", "desc")
    .limit(50)
    .execute();

  return {
    items: rows.map(
      (row) =>
        ({
          ...row,
          created_at: row.created_at.toISOString(),
        }) satisfies Submission,
    ),
  };
});

export const getStudentsIndexPageData = createServerFn({
  method: "GET",
}).handler(async () => {
  await requireAdminSession();

  const [students, families] = await Promise.all([
    rootDb
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
      .where("role", "=", "student")
      .execute(),
    rootDb
      .selectFrom("app_public.families")
      .select(["id", "slug", "name", "description", "created_at"])
      .orderBy("created_at", "desc")
      .execute(),
  ]);

  return {
    students: students.map((student) => ({
      ...student,
      name: student.name ?? "",
      email: student.email ?? "",
    })),
    families: families.map(
      (family) =>
        ({
          ...family,
          created_at: family.created_at.toISOString(),
        }) satisfies Family,
    ),
  };
});

export const getAssignmentsPageData = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSession();

  if (session.user.role === "admin" || session.user.role === "teacher") {
    await requireStaffSession();

    const [studentsRaw, allMaterials, assignedRows] = await Promise.all([
      studentSummarySelect(rootDb).execute(),
      rootDb
        .selectFrom("app_public.materials")
        .select([
          "id",
          "title",
          "original_filename",
          "mime_type",
          "file_size",
          "is_global",
          "notation_tracks",
        ])
        .orderBy("created_at", "desc")
        .execute(),
      rootDb
        .selectFrom("app_public.student_materials as sm")
        .innerJoin("app_public.materials as m", "m.id", "sm.material_id")
        .leftJoin("app_public.assignment_progress as ap", (join) =>
          join
            .onRef("ap.student_id", "=", "sm.student_id")
            .onRef("ap.material_id", "=", "sm.material_id"),
        )
        .select([
          "sm.student_id",
          "m.id",
          "m.title",
          "m.original_filename",
          "m.mime_type",
          "m.file_size",
          "m.is_global",
          "m.notation_tracks",
          "sm.assigned_track_index",
          sql<number>`coalesce(ap.listened_seconds, 0)`.as("listened_seconds"),
        ])
        .orderBy("sm.assigned_at", "desc")
        .execute(),
    ]);

    const assignedByStudent = new Map<string, AssignmentsStaffMaterial[]>();

    for (const row of assignedRows) {
      const existing = assignedByStudent.get(row.student_id);
      const material: AssignmentsStaffMaterial = serializeMaterial({
        id: row.id,
        title: row.title,
        original_filename: row.original_filename,
        mime_type: row.mime_type,
        file_size: row.file_size,
        is_global: row.is_global,
        notation_tracks: row.notation_tracks,
        assigned_track_index: row.assigned_track_index,
        listened_seconds: row.listened_seconds,
      });

      if (existing) {
        existing.push(material);
      } else {
        assignedByStudent.set(row.student_id, [material]);
      }
    }

    return {
      kind: "staff",
      students: normalizeStudents(studentsRaw).map((student) => ({
        id: student.id,
        username: student.username,
        name: student.name,
        email: student.email,
        assigned_materials: assignedByStudent.get(student.id) ?? [],
      })),
      allMaterials: allMaterials.map((material) => serializeMaterial(material)),
    } satisfies AssignmentsStaffData;
  }

  return withAuthContext(session.session.id, async (db) => {
    const [materials, progress, reviews] = await Promise.all([
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
          "m.notation_tracks",
          "sm.assigned_track_index",
        ])
        .execute(),
      db
        .selectFrom("app_public.assignment_progress")
        .select(["material_id", "listened_seconds", "updated_at"])
        .orderBy("updated_at", "desc")
        .execute(),
      db
        .selectFrom("app_public.assignment_reviews")
        .select(["id", "material_id", "stars", "listened_seconds", "created_at"])
        .orderBy("created_at", "desc")
        .execute(),
    ]);

    return {
      kind: "student",
      materials: materials.map((material) => serializeMaterial(material)),
      progress: progress.map(serializeAssignmentProgress),
      reviews: reviews.map(serializeAssignmentReview),
    } satisfies AssignmentsStudentData;
  });
});

export const getMyLessonsPageData = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSession();

  return withAuthContext(session.session.id, async (db) => {
    const [lessons, notes] = await Promise.all([
      db
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
        .limit(50)
        .execute(),
      db
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
        .limit(100)
        .execute(),
    ]);

    return {
      lessons: lessons.map(serializeLesson),
      notes: notes.map(serializeLessonNote),
    };
  });
});

export const getSettingsPageData = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSession();

  const emailsPromise = withAuthContext(session.session.id, async (db) => {
    const rows = await db
      .selectFrom("app_public.user_emails")
      .select(["id", "email", "is_verified", "is_primary", "created_at"])
      .orderBy("is_primary", "desc")
      .orderBy("created_at", "asc")
      .execute();

    return rows.map(
      (row) =>
        ({
          ...row,
          created_at: row.created_at.toISOString(),
        }) satisfies UserEmail,
    );
  });

  const testimonialPromise =
    session.user.role === "admin"
      ? Promise.resolve(null)
      : withAuthContext(session.session.id, async (db) => {
          const row = await testimonialsSelect(db, {
            userId: session.user.id,
            limit: 1,
          }).executeTakeFirst();
          return row ? serializeTestimonial(row) : null;
        });

  if (session.user.role !== "admin") {
    return {
      emails: await emailsPromise,
      testimonial: await testimonialPromise,
      gcalStatus: null,
      workingHours: null,
      testimonialReminderIntervalDays: null,
    };
  }

  const [emails, tokenRow, calIdRow, workingHoursRow, intervalDays] = await Promise.all([
    emailsPromise,
    rootDb
      .selectFrom("app_private.admin_settings")
      .select("value")
      .where("key", "=", "gcal_refresh_token")
      .executeTakeFirst(),
    rootDb
      .selectFrom("app_private.admin_settings")
      .select("value")
      .where("key", "=", "gcal_calendar_id")
      .executeTakeFirst(),
    rootDb
      .selectFrom("app_private.admin_settings")
      .select("value")
      .where("key", "=", "working_hours")
      .executeTakeFirst(),
    getTestimonialReminderIntervalDays(),
  ]);

  return {
    emails,
    testimonial: null,
    gcalStatus: {
      connected: tokenRow !== undefined,
      calendar_id: parseJsonValue<string | null>(
        (calIdRow?.value as JsonValue | null | undefined) ?? null,
        null,
      ),
    } satisfies GcalStatus,
    workingHours: parseJsonValue<WorkingHours>(
      (workingHoursRow?.value as JsonValue | null | undefined) ?? null,
      defaultWorkingHours,
    ),
    testimonialReminderIntervalDays: intervalDays,
  };
});

export const getCoursesIndexPageData = createServerFn({
  method: "GET",
}).handler(async () => {
  const session = await requireSession();

  if (session.user.role === "admin") {
    const courses = await rootDb
      .selectFrom("app_public.courses")
      .select(["id", "title", "description", "instrument"])
      .execute();

    return { isAdmin: true as const, courses: courses };
  }

  const courses = await withAuthContext(session.session.id, (db) =>
    db
      .selectFrom("app_public.courses")
      .select(["id", "title", "description", "instrument"])
      .execute(),
  );

  return { isAdmin: false as const, courses: courses };
});

export const getStudentDetailPageData = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await requireAdminSession();

    const [studentRaw, allCourses, allMaterials] = await Promise.all([
      rootDb
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
        .where("id", "=", data.id)
        .where("role", "=", "student")
        .executeTakeFirst(),
      rootDb
        .selectFrom("app_public.courses")
        .select(["id", "title", "description", "instrument"])
        .execute(),
      rootDb
        .selectFrom("app_public.materials")
        .select([
          "id",
          "title",
          "original_filename",
          "mime_type",
          "file_size",
          "is_global",
          "notation_tracks",
        ])
        .orderBy("created_at", "desc")
        .limit(50)
        .execute(),
    ]);

    if (!studentRaw) {
      throw new HttpError(404, "Student not found");
    }

    const [enrolledCourses, assignedMaterials] = await Promise.all([
      rootDb
        .selectFrom("app_public.enrollments as e")
        .innerJoin("app_public.courses as c", "c.id", "e.course_id")
        .where("e.student_id", "=", data.id)
        .select(["c.id", "c.title", "c.instrument"])
        .execute(),
      rootDb
        .selectFrom("app_public.student_materials as sm")
        .innerJoin("app_public.materials as m", "m.id", "sm.material_id")
        .where("sm.student_id", "=", data.id)
        .select([
          "m.id",
          "m.title",
          "m.original_filename",
          "m.mime_type",
          "m.file_size",
          "m.is_global",
          "m.notation_tracks",
          "sm.assigned_track_index",
        ])
        .execute(),
    ]);

    return {
      student: {
        ...studentRaw,
        name: studentRaw.name ?? "",
        email: studentRaw.email ?? "",
        enrolled_courses: enrolledCourses,
        assigned_materials: assignedMaterials.map((material) => serializeMaterial(material)),
      } satisfies StudentDetail,
      allCourses: allCourses,
      allMaterials: allMaterials.map((material) => serializeMaterial(material)),
    };
  });

export const getCourseDetailPageData = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const session = await requireSession();

    const course = await withAuthContext(session.session.id, async (db) => {
      const courseRow = await db
        .selectFrom("app_public.courses")
        .select(["id", "title", "description", "instrument"])
        .where("id", "=", data.id)
        .executeTakeFirst();

      if (!courseRow) {
        throw new HttpError(404, "Course not found");
      }

      const modules = await db
        .selectFrom("app_public.modules")
        .select(["id", "course_id", "title", "content", "sort_order"])
        .where("course_id", "=", data.id)
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
              "mat.notation_tracks",
            ])
            .orderBy("mm.sort_order")
            .execute();

          return {
            ...mod,
            materials: materials.map((material) => serializeMaterial(material)),
          };
        }),
      );

      return { ...courseRow, modules: modulesWithMaterials };
    });

    if (session.user.role !== "admin") {
      return {
        isAdmin: false as const,
        course,
        enrolledStudents: [],
        allStudents: [],
      };
    }

    const [enrolledStudents, allStudents] = await Promise.all([
      rootDb
        .selectFrom("app_public.enrollments as e")
        .innerJoin("app_public.users as u", "u.id", "e.student_id")
        .where("e.course_id", "=", data.id)
        .select(["u.id", "u.username", "u.name", "u.role", "u.is_verified"])
        .select((eb) =>
          eb
            .selectFrom("app_public.user_emails")
            .select("email")
            .whereRef("app_public.user_emails.user_id", "=", "u.id")
            .where("is_primary", "=", true)
            .limit(1)
            .as("email"),
        )
        .execute(),
      rootDb
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
        .where("role", "=", "student")
        .execute(),
    ]);

    return {
      isAdmin: true as const,
      course,
      enrolledStudents: enrolledStudents.map((student) => ({
        ...student,
        name: student.name ?? "",
        email: student.email ?? "",
      })),
      allStudents: allStudents.map((student) => ({
        ...student,
        name: student.name ?? "",
        email: student.email ?? "",
      })),
    };
  });

export const getModuleEditPageData = createServerFn({ method: "GET" })
  .inputValidator((input: { moduleId: string }) => input)
  .handler(async ({ data }) => {
    await requireAdminSession();

    const [mod, allMaterials] = await Promise.all([
      rootDb
        .selectFrom("app_public.modules")
        .select(["id", "course_id", "title", "content", "sort_order"])
        .where("id", "=", data.moduleId)
        .executeTakeFirst(),
      rootDb
        .selectFrom("app_public.materials")
        .select([
          "id",
          "title",
          "original_filename",
          "mime_type",
          "file_size",
          "is_global",
          "notation_tracks",
        ])
        .orderBy("created_at", "desc")
        .limit(50)
        .execute(),
    ]);

    if (!mod) {
      throw new HttpError(404, "Module not found");
    }

    return {
      mod,
      allMaterials: allMaterials.map((material) => serializeMaterial(material)),
    };
  });

export const getLibraryPageData = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSession();

  const materials = await withAuthContext(session.session.id, (db) =>
    db
      .selectFrom("app_public.materials")
      .select([
        "id",
        "title",
        "original_filename",
        "mime_type",
        "file_size",
        "is_global",
        "notation_tracks",
      ])
      .orderBy("created_at", "desc")
      .limit(50)
      .execute(),
  );

  return {
    isAdmin: session.user.role === "admin",
    materials: materials.map((material) => serializeMaterial(material)),
  };
});

export const getLessonNote = createServerFn({ method: "GET" })
  .inputValidator((input: { lessonId: string }) => input)
  .handler(async ({ data }) => {
    await requireAdminSession();

    const note = await rootDb
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
      .executeTakeFirst();

    if (!note) {
      throw new HttpError(404, "Lesson note not found");
    }

    return serializeLessonNote(note);
  });

export const getLessonsPageData = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminSession();

  const result = await rootDb
    .selectNoFrom((eb) => [
      jsonArrayFrom(lessonsSelect(rootDb, { limit: 50 })).as("lessons"),
      jsonArrayFrom(studentSummarySelect(rootDb)).as("students"),
    ])
    .executeTakeFirstOrThrow();

  return {
    lessons: parseJsonValue(result.lessons as JsonValue | null, []).map(serializeLesson),
    students: normalizeStudents(
      parseJsonValue(result.students as JsonValue | null, [] as UserRecord[]),
    ),
  };
});

export const getMessagesPageData = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSession();

  const result = await withAuthContext(session.session.id, async (db) =>
    db
      .selectNoFrom(() => [
        jsonArrayFrom(messagesSelect(db)).as("messages"),
        session.user.role === "admin"
          ? jsonArrayFrom(studentSummarySelect(rootDb)).as("students")
          : sql`'[]'::json`.as("students"),
      ])
      .executeTakeFirstOrThrow(),
  );

  return {
    messages: parseJsonValue(result.messages as JsonValue | null, [] as MessageRecord[]).map(
      (message) => ({
        ...message,
        created_at: toIsoString(message.created_at),
      }),
    ) as Message[],
    students: normalizeStudents(
      parseJsonValue(result.students as JsonValue | null, [] as UserRecord[]),
    ),
  };
});

export const getDashboardPageData = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSession();

  if (session.user.role === "admin") {
    const today = todayRange();
    const week = weekRange();

    const result = await rootDb
      .selectNoFrom(() => [
        jsonArrayFrom(studentSummarySelect(rootDb)).as("students"),
        jsonArrayFrom(messagesSelect(rootDb)).as("messages"),
        jsonArrayFrom(lessonsSelect(rootDb, { from: today.from, to: today.to })).as("todayLessons"),
        jsonArrayFrom(lessonsSelect(rootDb, { from: week.from, to: week.to })).as("weekLessons"),
      ])
      .executeTakeFirstOrThrow();

    return {
      kind: "admin",
      students: normalizeStudents(
        parseJsonValue(result.students as JsonValue | null, [] as UserRecord[]),
      ),
      messages: parseJsonValue(result.messages as JsonValue | null, [] as MessageRecord[]).map(
        (message) => ({
          ...message,
          created_at: toIsoString(message.created_at),
        }),
      ) as Message[],
      todayLessons: parseJsonValue(result.todayLessons as JsonValue | null, []).map(
        serializeLesson,
      ),
      weekLessons: parseJsonValue(result.weekLessons as JsonValue | null, []).map(serializeLesson),
    } satisfies DashboardAdminData;
  }

  const [result, canShowTestimonialPrompt] = await Promise.all([
    withAuthContext(session.session.id, async (db) =>
      db
        .selectNoFrom(() => [
          jsonArrayFrom(messagesSelect(db)).as("messages"),
          jsonArrayFrom(assignmentsSelect(db)).as("assignments"),
          jsonArrayFrom(lessonsSelect(db, { status: "scheduled", limit: 5 })).as(
            "scheduledLessons",
          ),
          jsonArrayFrom(coursesSelect(db)).as("courses"),
          jsonObjectFrom(testimonialsSelect(db, { userId: session.user.id, limit: 1 })).as(
            "testimonial",
          ),
        ])
        .executeTakeFirstOrThrow(),
    ),
    getTestimonialPromptEnabled(session.user.id),
  ]);

  const testimonial = parseJsonValue<{
    id: string;
    user_id: string;
    body: string;
    username: string;
    name: string | null;
    role: "admin" | "student" | "parent" | "teacher";
    created_at: Date | string;
    updated_at: Date | string;
  } | null>(result.testimonial as JsonValue | null, null);

  return {
    kind: "student",
    messages: parseJsonValue(result.messages as JsonValue | null, [] as MessageRecord[]).map(
      (message) => ({
        ...message,
        created_at: toIsoString(message.created_at),
      }),
    ) as Message[],
    assignments: parseJsonValue(result.assignments as JsonValue | null, []) as Material[],
    scheduledLessons: parseJsonValue(result.scheduledLessons as JsonValue | null, []).map(
      serializeLesson,
    ),
    courses: parseJsonValue(result.courses as JsonValue | null, []) as Course[],
    testimonial: testimonial ? serializeTestimonial(testimonial) : null,
    canShowTestimonialPrompt,
  } satisfies DashboardStudentData;
});

export const getHomePageData = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await testimonialsSelect(rootDb, { limit: 6 }).execute();

  return {
    testimonials: rows.map(serializeTestimonial),
  };
});

export const getBookLessonPageData = createServerFn({ method: "GET" })
  .inputValidator((input: { date: string }) => input)
  .handler(async ({ data }) => {
    await requireSession();

    return {
      date: data.date,
      slots: await googleCalendarService.getAvailableSlots({
        date: data.date,
        days: 7,
        duration: 60,
      }),
    };
  });

export const getAssignmentNote = createServerFn({ method: "GET" })
  .inputValidator((input: { materialId: string }) => input)
  .handler(async ({ data }) => {
    const session = await requireSession();

    return withAuthContext(session.session.id, async (db) => {
      const row = await db
        .selectFrom("app_public.assignment_notes")
        .selectAll()
        .where("material_id", "=", data.materialId)
        .executeTakeFirst();

      if (!row) {
        return null;
      }

      return {
        ...row,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      } satisfies AssignmentNote;
    });
  });

export const getAvailableStudentMaterials = createServerFn({ method: "GET" })
  .inputValidator((input: { studentId: string }) => input)
  .handler(async ({ data }) => {
    await requireAdminSession();

    const materialIds = await rootDb
      .selectFrom("app_public.student_materials")
      .select("material_id")
      .where("student_id", "=", data.studentId)
      .execute();

    const assignedIds = materialIds.map((row) => row.material_id);

    if (assignedIds.length === 0) {
      return [];
    }

    return rootDb
      .selectFrom("app_public.materials")
      .select([
        "id",
        "title",
        "original_filename",
        "mime_type",
        "file_size",
        "is_global",
        "notation_tracks",
      ])
      .where("id", "in", assignedIds)
      .orderBy("created_at", "desc")
      .execute()
      .then((materials) => materials.map((material) => serializeMaterial(material)));
  });

export const getAvailableCourseEnrollments = createServerFn({ method: "GET" })
  .inputValidator((input: { courseId: string }) => input)
  .handler(async ({ data }) => {
    await requireAdminSession();

    const rows = await rootDb
      .selectFrom("app_public.enrollments as e")
      .innerJoin("app_public.users as u", "u.id", "e.student_id")
      .where("e.course_id", "=", data.courseId)
      .select(["u.id", "u.username", "u.name", "u.role", "u.is_verified"])
      .select((eb) =>
        eb
          .selectFrom("app_public.user_emails")
          .select("email")
          .whereRef("app_public.user_emails.user_id", "=", "u.id")
          .where("is_primary", "=", true)
          .limit(1)
          .as("email"),
      )
      .execute();

    return rows.map((row) => ({
      ...row,
      name: row.name ?? "",
      email: row.email ?? "",
    }));
  });

export const getFamilyInvitationSummary = createServerFn({ method: "GET" })
  .inputValidator((input: { familyId: string }) => input)
  .handler(async ({ data }) => {
    await requireAdminSession();

    return rootDb
      .selectFrom(
        sql<{ count: number }>`(
          select count(*)::int as count
          from app_public.family_invitations
          where family_id = ${data.familyId}::uuid
        )`.as("counts"),
      )
      .select("count")
      .executeTakeFirstOrThrow();
  });
