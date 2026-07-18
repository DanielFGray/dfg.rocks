import { Effect, Option, Schema, Stream } from "effect";
import { PgClient } from "@effect/sql-pg/PgClient";
import { PgRootDB } from "../db.js";
import { realtimeBus } from "./realtimeBus.js";

type QueryKey = readonly string[];

const CHANNEL_QUERY_KEYS: Record<string, QueryKey[]> = {
  "rt:messages": [["messages"]],
  "rt:lessons": [
    ["my-lessons"],
    ["my-lessons", "scheduled"],
    ["available-slots"],
    ["admin-lessons"],
    ["admin", "lessons"],
  ],
  "rt:courses": [["courses"], ["admin", "courses"], ["admin", "students"]],
  "rt:modules": [["courses"], ["admin", "courses"]],
  "rt:materials": [
    ["library"],
    ["courses"],
    ["assignments"],
    ["admin", "courses"],
    ["admin", "students"],
  ],
  "rt:student_materials": [["assignments"], ["courses"], ["admin", "students"]],
  "rt:module_materials": [["courses"], ["assignments"], ["library"], ["admin", "courses"]],
  "rt:enrollments": [["courses"], ["assignments"], ["admin", "students"], ["admin", "courses"]],
  "rt:family_memberships": [
    ["auth", "user"],
    ["messages"],
    ["assignments"],
    ["courses"],
    ["my-lessons"],
  ],
  "rt:lesson_notes": [["my-lessons"], ["my-lesson-notes"], ["admin-lessons"], ["admin", "lessons"]],
  "rt:practice_logs": [["practice-logs"]],
  "rt:assignment_notes": [["assignment-note"], ["assignments"]],
  "rt:lesson_deposits": [["my-lessons"], ["admin-lessons"], ["admin", "lessons"]],
  "rt:assignment_progress": [["assignments"]],
  "rt:assignment_reviews": [["assignments"]],
};

const RealtimePayload = Schema.parseJson(
  Schema.Struct({
    event: Schema.optional(Schema.String),
    subject: Schema.optional(Schema.String),
  }),
);

function dedupe(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((value) => value.length > 0))];
}

export class RealtimeService extends Effect.Service<RealtimeService>()("RealtimeService", {
  accessors: true,
  scoped: Effect.gen(function* () {
    const client = yield* PgClient;
    const db = yield* PgRootDB;

    let staffCache: { ids: string[]; expiresAt: number } | null = null;

    const getStaffIds = Effect.fnUntraced(function* () {
      const now = Date.now();
      if (staffCache && staffCache.expiresAt > now) {
        return staffCache.ids;
      }

      const rows = yield* db
        .selectFrom("app_public.users")
        .select("id")
        .where((eb) => eb.or([eb("role", "=", "admin"), eb("role", "=", "teacher")]));

      const ids = rows.map((row) => row.id);
      staffCache = { ids, expiresAt: now + 30_000 };
      return ids;
    });

    const expandUserIds = Effect.fnUntraced(function* (
      baseUserIds: readonly string[],
      options: { includeStaff?: boolean } = {},
    ) {
      const userIds = dedupe(baseUserIds);
      const familyIds =
        userIds.length === 0
          ? []
          : (yield* db
              .selectFrom("app_public.family_memberships as fm_source")
              .innerJoin(
                "app_public.family_memberships as fm_related",
                "fm_related.family_id",
                "fm_source.family_id",
              )
              .select("fm_related.user_id")
              .where("fm_source.user_id", "in", userIds)).map((row) => row.user_id);

      const staffIds = options.includeStaff ? yield* getStaffIds() : [];
      return dedupe([...userIds, ...familyIds, ...staffIds]);
    });

    const studentScopedUserIds = (studentId: string) =>
      expandUserIds([studentId], { includeStaff: true });

    const usersForCourse = Effect.fnUntraced(function* (courseId: string) {
      const rows = yield* db
        .selectFrom("app_public.enrollments")
        .select("student_id")
        .where("course_id", "=", courseId);

      return yield* expandUserIds(
        rows.map((row) => row.student_id),
        { includeStaff: true },
      );
    });

    const usersForModule = Effect.fnUntraced(function* (moduleId: string) {
      const rows = yield* db
        .selectFrom("app_public.module_materials as mm")
        .innerJoin("app_public.modules as m", "m.id", "mm.module_id")
        .innerJoin("app_public.enrollments as e", "e.course_id", "m.course_id")
        .select("e.student_id")
        .where("mm.module_id", "=", moduleId);

      return yield* expandUserIds(
        rows.map((row) => row.student_id),
        { includeStaff: true },
      );
    });

    const usersForMaterial = Effect.fnUntraced(function* (materialId: string) {
      const rows = yield* db
        .selectFrom("app_public.student_materials")
        .select("student_id")
        .where("material_id", "=", materialId)
        .union(
          db
            .selectFrom("app_public.module_materials as mm")
            .innerJoin("app_public.modules as m", "m.id", "mm.module_id")
            .innerJoin("app_public.enrollments as e", "e.course_id", "m.course_id")
            .select("e.student_id")
            .where("mm.material_id", "=", materialId),
        );

      return yield* expandUserIds(
        rows.map((row) => row.student_id),
        { includeStaff: true },
      );
    });

    const usersForLesson = Effect.fnUntraced(function* (lessonId: string) {
      return yield* yield* db
        .selectFrom("app_public.lessons")
        .select("student_id")
        .where("id", "=", lessonId)
        .pipe(
          Effect.head,
          Effect.option,
          Effect.map(
            Option.match({
              onNone: getStaffIds,
              onSome: (value) => studentScopedUserIds(value.student_id),
            }),
          ),
        );
    });

    const resolveUserIds = Effect.fnUntraced(function* (channel: string, subject: string) {
      switch (channel) {
        case "rt:messages":
        case "rt:family_memberships":
        case "rt:student_materials":
        case "rt:enrollments":
        case "rt:practice_logs":
        case "rt:assignment_notes":
        case "rt:lessons":
        case "rt:assignment_progress":
        case "rt:assignment_reviews":
          return yield* studentScopedUserIds(subject);
        case "rt:courses":
        case "rt:modules":
          return yield* usersForCourse(subject);
        case "rt:module_materials":
          return yield* usersForModule(subject);
        case "rt:materials":
          return yield* usersForMaterial(subject);
        case "rt:lesson_notes":
        case "rt:lesson_deposits":
          return yield* usersForLesson(subject);
        default:
          return [];
      }
    });

    const processNotification = Effect.fnUntraced(function* (channel: string, rawPayload: string) {
      const queryKeys = CHANNEL_QUERY_KEYS[channel];
      if (!queryKeys) {
        return;
      }

      const parsed = yield* Schema.decodeUnknown(RealtimePayload)(rawPayload).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );
      if (!parsed) {
        return;
      }

      const subject = parsed.subject;
      if (!subject) {
        return;
      }

      const userIds = yield* resolveUserIds(channel, subject);
      if (userIds.length === 0) {
        return;
      }

      yield* Effect.forEach(userIds, (userId) =>
        Effect.sync(() =>
          realtimeBus.publish({
            userId,
            event: parsed.event ?? channel,
            subject,
            queryKeys,
          }),
        ),
      );
    });

    yield* Effect.forEach(
      Object.keys(CHANNEL_QUERY_KEYS),
      Effect.fnUntraced(function* (channel) {
        yield* Effect.forkScoped(
          client.listen(channel).pipe(
            Stream.mapEffect((rawPayload) => processNotification(channel, rawPayload), {
              concurrency: "unbounded",
            }),
            Stream.runDrain,
          ),
        );
        yield* Effect.sleep("10 millis");
      }),
      { concurrency: 1 },
    );

    return {};
  }),
}) {}
