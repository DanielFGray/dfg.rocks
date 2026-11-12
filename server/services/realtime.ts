import {
  Config,
  Context,
  Deferred,
  Effect,
  Layer,
  Option,
  PubSub,
  Queue,
  Redacted,
  Schedule,
  Stream,
} from "effect";
import { ConnectionError, SqlError } from "effect/sql/SqlError";
import { sql } from "kysely";
import pg from "pg";
import { PgRootDB } from "../db.js";
type QueryKey = readonly string[];

/** A change one signed-in user should see: the client refetches `queryKeys`. */
type RealtimeMessage = {
  readonly userId: string;
  readonly event: string;
  readonly subject: string;
  readonly queryKeys: readonly QueryKey[];
};

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

function dedupe(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((value) => value.length > 0))];
}

export class Realtime extends Context.Service<Realtime>()("dfg-rocks/realtime", {
  make: Effect.gen(function* () {
    const databaseUrl = yield* Config.Redacted("DATABASE_URL");
    const db = yield* PgRootDB;
    const hub = yield* PubSub.unbounded<RealtimeMessage>();

    let staffCache: { ids: string[]; expiresAt: number } | null = null;

    const getStaffIds = Effect.fnUntraced(function* () {
      const now = Date.now();
      if (staffCache && staffCache.expiresAt > now) {
        return staffCache.ids;
      }

      const rows = yield* db.execute(
        db
          .selectFrom("app_public.users")
          .select("id")
          .where((eb) => eb.or([eb("role", "=", "admin"), eb("role", "=", "teacher")])),
      );

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
          : (yield* db.execute(
              db
                .selectFrom("app_public.family_memberships as fm_source")
                .innerJoin(
                  "app_public.family_memberships as fm_related",
                  "fm_related.family_id",
                  "fm_source.family_id",
                )
                .select("fm_related.user_id")
                .where("fm_source.user_id", "in", userIds),
            )).map((row) => row.user_id);

      const staffIds = options.includeStaff ? yield* getStaffIds() : [];
      return dedupe([...userIds, ...familyIds, ...staffIds]);
    });

    const studentScopedUserIds = (studentId: string) =>
      expandUserIds([studentId], { includeStaff: true });

    const usersForCourse = Effect.fnUntraced(function* (courseId: string) {
      const rows = yield* db.execute(
        db
          .selectFrom("app_public.enrollments")
          .select("student_id")
          .where("course_id", "=", courseId),
      );

      return yield* expandUserIds(
        rows.map((row) => row.student_id),
        { includeStaff: true },
      );
    });

    const usersForModule = Effect.fnUntraced(function* (moduleId: string) {
      const rows = yield* db.execute(
        db
          .selectFrom("app_public.module_materials as mm")
          .innerJoin("app_public.modules as m", "m.id", "mm.module_id")
          .innerJoin("app_public.enrollments as e", "e.course_id", "m.course_id")
          .select("e.student_id")
          .where("mm.module_id", "=", moduleId),
      );

      return yield* expandUserIds(
        rows.map((row) => row.student_id),
        { includeStaff: true },
      );
    });

    const usersForMaterial = Effect.fnUntraced(function* (materialId: string) {
      const rows = yield* db.execute(
        db
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
          ),
      );

      return yield* expandUserIds(
        rows.map((row) => row.student_id),
        { includeStaff: true },
      );
    });

    const usersForLesson = Effect.fnUntraced(function* (lessonId: string) {
      return yield* yield* db
        .execute(
          db.selectFrom("app_public.lessons").select("student_id").where("id", "=", lessonId),
        )
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

    const processEvent = Effect.fnUntraced(function* (row: {
      readonly topic: string;
      readonly event: string;
      readonly subject: string;
    }) {
      const queryKeys = CHANNEL_QUERY_KEYS[row.topic];
      if (!queryKeys) {
        return;
      }

      const userIds = yield* resolveUserIds(row.topic, row.subject);
      if (userIds.length === 0) {
        return;
      }

      yield* PubSub.publishAll(
        hub,
        userIds.map((userId) => ({
          userId,
          event: row.event,
          subject: row.subject,
          queryKeys,
        })),
      );
    });

    // Events written before this process started were delivered by whoever listened then.
    let highWater =
      (yield* db.execute(
        db
          .selectFrom("app_private.realtime_events")
          .select((eb) => eb.fn.coalesce(eb.fn.max("id"), eb.lit(0)).as("max")),
      ))[0]?.max ?? 0;

    const drainNewRows = Effect.gen(function* () {
      const rows = yield* db.execute(
        db
          .selectFrom("app_private.realtime_events")
          .select(["id", "topic", "event", "subject"])
          .where("id", ">", highWater)
          .orderBy("id"),
      );
      for (const row of rows) {
        yield* processEvent(row);
        highWater = row.id;
      }
    });

    // One connection's lifetime: LISTEN, read rows that arrived while nothing
    // listened, then read again on each notification until the connection is lost.
    const listen = Effect.scoped(
      Effect.gen(function* () {
        const lost = yield* Deferred.make<never, SqlError>();
        const client = yield* connectListenClient(databaseUrl, lost);
        const notifications = yield* Queue.unbounded<void>();
        client.on("notification", () => {
          Queue.offerUnsafe(notifications, undefined);
        });
        yield* Effect.tryPromise({
          try: () => client.query("LISTEN realtime_events"),
          catch: toSqlError("LISTEN realtime_events failed"),
        });
        yield* drainNewRows;
        yield* Effect.raceFirst(
          Stream.fromQueue(notifications).pipe(
            Stream.mapEffect(() => drainNewRows),
            Stream.runDrain,
          ),
          Deferred.await(lost),
        );
      }),
    );

    yield* Effect.forkScoped(
      listen.pipe(
        Effect.tapError((error) =>
          Effect.logWarning("Realtime listener lost its connection", error),
        ),
        Effect.retry(Schedule.spaced("5 seconds").pipe(Schedule.jittered)),
      ),
    );

    yield* Effect.forkScoped(
      db
        .execute(
          db
            .deleteFrom("app_private.realtime_events")
            .where("created_at", "<", sql<Date>`now() - interval '24 hours'`),
        )
        .pipe(
          Effect.catch((error) => Effect.logWarning("Realtime cleanup failed", error)),
          Effect.repeat(Schedule.spaced("1 hour")),
        ),
    );

    return {
      /** Every message published after the stream starts, for every user. */
      messages: Stream.fromPubSub(hub),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(PgRootDB.layer));
}

const toSqlError = (message: string) => (cause: unknown) =>
  new SqlError({ reason: new ConnectionError({ cause, message }) });

/**
 * A dedicated LISTEN connection outside the pool. pg reports a dropped
 * connection as an 'error' event, which crashes the process when nothing
 * handles it, so the handler is attached before connect and fails `lost`.
 */
const connectListenClient = (url: Redacted.Redacted, lost: Deferred.Deferred<never, SqlError>) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const client = new pg.Client({ connectionString: Redacted.value(url) });
        client.on("error", (cause) => {
          Deferred.doneUnsafe(
            lost,
            Effect.fail(toSqlError("Realtime listen connection lost")(cause)),
          );
        });
        await client.connect();
        return client;
      },
      catch: toSqlError("Realtime listen connection failed"),
    }),
    (client) => Effect.promise(() => client.end().catch(() => undefined)),
  );
