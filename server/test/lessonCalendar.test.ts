import { expect, it } from "@effect/vitest";
import { Effect, Layer, Ref, Schema } from "effect";
import { sql } from "kysely";
import { PgAuthDB, PgRootDB } from "../db.js";
import { withAuthContext } from "../requestDatabase.js";
import { GoogleCalendar } from "../services/googleCalendar.js";
import { LessonPolicy } from "../services/lessonPolicy.js";
import { Lessons } from "../services/lessons.js";
import { CalendarSync } from "../../worker/calendar/calendarSync.js";
import { WorkerTasks } from "../../worker/workerTasks.js";
import { EmailDelivery } from "../../worker/email/emailDelivery.js";
import { HttpError } from "../pgErrors.js";
import * as HttpClient from "effect/http/HttpClient";

const forbidden = () => Effect.die(new Error("Google must not run in a lesson transaction"));
const forbiddenGoogle: GoogleCalendar["Service"] = {
  getGoogleCalendarStatus: forbidden,
  disconnectGoogleCalendar: forbidden,
  handleCallback: forbidden,
  isConnected: forbidden,
  disconnect: forbidden,
  listEvents: forbidden,
  createEvent: forbidden,
  deleteEvent: forbidden,
  updateEvent: forbidden,
  getAvailableSlots: forbidden,
  getWorkingHours: forbidden,
  setWorkingHours: forbidden,
  getSyncToken: forbidden,
  incrementalSync: forbidden,
  createAuthorizationRequest: forbidden,
};

const database = Layer.mergeAll(PgRootDB.layer, PgAuthDB.layer);
const services = Layer.mergeAll(
  Lessons.layer,
  LessonPolicy.layer,
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() => Effect.die(new Error("Unexpected HTTP request"))),
  ),
).pipe(Layer.provideMerge(database));
const CalendarPayload = Schema.Struct({
  lessonId: Schema.String,
  gcalEventId: Schema.NullOr(Schema.String),
});

it.layer(services)("lesson calendar queue", (test) => {
  for (const method of [
    "create",
    "update",
    "delete",
    "cancel",
    "cancel-own",
    "reschedule",
    "book",
  ] as const) {
    test.effect(`${method} queues synchronization without calling Google`, () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture;
        const service = yield* Lessons;
        const mutations = {
          create: service.createLesson({
            studentId: fixture.studentId,
            scheduledAt: fixture.nextTime,
            durationMinutes: 60,
            locationType: "online",
            gcalEventId: null,
          }),
          update: service.updateLesson(fixture.lesson.id, { scheduledAt: fixture.nextTime }),
          delete: service.deleteLesson(fixture.lesson.id),
          cancel: service.cancelLesson(fixture.lesson.id, null),
          "cancel-own": service.cancelMyLesson({
            studentId: fixture.studentId,
            lessonId: fixture.lesson.id,
            reason: null,
          }),
          reschedule: service.rescheduleMyLesson({
            studentId: fixture.studentId,
            lessonId: fixture.lesson.id,
            scheduledAt: fixture.nextTime,
          }),
          book: service.bookLesson({
            userId: fixture.studentId,
            scheduledAt: fixture.nextTime,
            durationMinutes: 60,
            locationType: "online",
          }),
        };
        const lesson = yield* mutations[method].pipe(
          withAuthContext(fixture.sessionId),
          Effect.provideService(GoogleCalendar, forbiddenGoogle),
        );
        expect(yield* queuedJobs(lesson.id)).toEqual([
          {
            lessonId: lesson.id,
            gcalEventId:
              method === "create" || method === "book" ? null : fixture.lesson.gcal_event_id,
          },
        ]);
      }).pipe(Effect.scoped),
    );
  }

  test.effect("an insert queues its payload in the row transaction", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture;
      const lesson = yield* fixture.db
        .execute(
          fixture.db
            .insertInto("app_public.lessons")
            .values({
              student_id: fixture.studentId,
              scheduled_at: fixture.nextTime,
              duration_minutes: 60,
              location_type: "online",
            })
            .returning("id"),
        )
        .pipe(Effect.head);
      expect(yield* queuedJobs(lesson.id)).toEqual([{ lessonId: lesson.id, gcalEventId: null }]);
    }).pipe(Effect.scoped),
  );

  test.effect(
    "repeated time, cancel and delete changes replace one job and retain the old event ID",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture;
        const expected = [
          { lessonId: fixture.lesson.id, gcalEventId: fixture.lesson.gcal_event_id },
        ];
        yield* fixture.db.execute(
          fixture.db
            .updateTable("app_public.lessons")
            .set({ scheduled_at: fixture.nextTime })
            .where("id", "=", fixture.lesson.id),
        );
        expect(yield* queuedJobs(fixture.lesson.id)).toEqual(expected);
        yield* fixture.db.execute(
          fixture.db
            .updateTable("app_public.lessons")
            .set({ status: "cancelled" })
            .where("id", "=", fixture.lesson.id),
        );
        expect(yield* queuedJobs(fixture.lesson.id)).toEqual(expected);
        yield* fixture.db.execute(
          fixture.db.deleteFrom("app_public.lessons").where("id", "=", fixture.lesson.id),
        );
        expect(yield* queuedJobs(fixture.lesson.id)).toEqual(expected);
      }).pipe(Effect.scoped),
  );

  test.effect("changing only the calendar event ID does not queue a job", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture;
      yield* fixture.db.execute(
        fixture.db
          .updateTable("app_public.lessons")
          .set({ gcal_event_id: null })
          .where("id", "=", fixture.lesson.id),
      );
      expect(yield* queuedJobs(fixture.lesson.id)).toEqual([]);
    }).pipe(Effect.scoped),
  );

  test.effect("a caller rollback removes the calendar job and the lesson change", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture;
      const service = yield* Lessons;
      const failure = yield* service
        .updateLesson(fixture.lesson.id, { scheduledAt: fixture.nextTime })
        .pipe(
          Effect.andThen(Effect.fail("rollback")),
          withAuthContext(fixture.sessionId),
          Effect.flip,
        );
      expect(failure).toBe("rollback");
      expect(yield* queuedJobs(fixture.lesson.id)).toEqual([]);
      const row = yield* fixture.db
        .execute(
          fixture.db
            .selectFrom("app_public.lessons")
            .select("scheduled_at")
            .where("id", "=", fixture.lesson.id),
        )
        .pipe(Effect.head);
      expect(row.scheduled_at.getTime()).toBe(fixture.nextTime.getTime() - 86400000);
    }).pipe(Effect.scoped),
  );

  for (const scenario of ["create", "update", "cancel", "missing", "disconnected"] as const) {
    test.effect(`worker reconciles ${scenario}`, () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture;
        const recorded = yield* recordingCalendar;
        if (scenario === "create")
          yield* fixture.db.execute(
            fixture.db
              .updateTable("app_public.lessons")
              .set({ gcal_event_id: null })
              .where("id", "=", fixture.lesson.id),
          );
        if (scenario === "cancel")
          yield* fixture.db.execute(
            fixture.db
              .updateTable("app_public.lessons")
              .set({ status: "cancelled" })
              .where("id", "=", fixture.lesson.id),
          );
        if (scenario === "missing")
          yield* fixture.db.execute(
            fixture.db.deleteFrom("app_public.lessons").where("id", "=", fixture.lesson.id),
          );
        yield* removeJob(fixture.lesson.id);
        const calendar =
          scenario === "disconnected"
            ? { ...forbiddenGoogle, isConnected: () => Effect.succeed(false) }
            : recorded.calendar;
        yield* runCalendarJob({
          lessonId: fixture.lesson.id,
          gcalEventId: fixture.lesson.gcal_event_id,
        }).pipe(Effect.provideService(GoogleCalendar, calendar));
        const details = {
          summary: "Lesson: Calendar Student",
          description: "60 min online lesson",
          start: new Date(fixture.nextTime.getTime() - 86400000).toISOString(),
          end: new Date(fixture.nextTime.getTime() - 86400000 + 3600000).toISOString(),
        };
        expect(yield* recorded.calls).toEqual(
          scenario === "disconnected"
            ? []
            : scenario === "create"
              ? [
                  {
                    method: "create",
                    event: { id: "df9123e4567e89b12d3a456426614174000", ...details },
                  },
                ]
              : scenario === "update"
                ? [{ method: "update", id: fixture.lesson.gcal_event_id, event: details }]
                : [{ method: "delete", id: fixture.lesson.gcal_event_id }],
        );
        const row = yield* fixture.db.execute(
          fixture.db
            .selectFrom("app_public.lessons")
            .select("gcal_event_id")
            .where("id", "=", fixture.lesson.id),
        );
        expect(row).toEqual(
          scenario === "missing"
            ? []
            : [
                {
                  gcal_event_id:
                    scenario === "create"
                      ? "df9123e4567e89b12d3a456426614174000"
                      : scenario === "cancel"
                        ? null
                        : fixture.lesson.gcal_event_id,
                },
              ],
        );
        expect(yield* queuedJobs(fixture.lesson.id)).toEqual([]);
      }).pipe(Effect.scoped),
    );
  }

  test.effect("worker failures stay failed for retry", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture;
      const error = new HttpError({ status: 503, message: "Google unavailable" });
      const calendar = {
        ...forbiddenGoogle,
        isConnected: () => Effect.succeed(true),
        updateEvent: () => Effect.fail(error),
      };
      expect(
        yield* runCalendarJob({ lessonId: fixture.lesson.id, gcalEventId: null }).pipe(
          Effect.provideService(GoogleCalendar, calendar),
          Effect.flip,
        ),
      ).toEqual(error);
    }).pipe(Effect.scoped),
  );

  test.effect(
    "a missing row without a stored event ID still removes a partially created event",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture;
        const recorded = yield* recordingCalendar;
        yield* fixture.db.execute(
          fixture.db.deleteFrom("app_public.lessons").where("id", "=", fixture.lesson.id),
        );
        yield* runCalendarJob({ lessonId: fixture.lesson.id, gcalEventId: null }).pipe(
          Effect.provideService(GoogleCalendar, recorded.calendar),
        );
        expect(yield* recorded.calls).toEqual([
          { method: "delete", id: "df9123e4567e89b12d3a456426614174000" },
        ]);
      }).pipe(Effect.scoped),
  );

  test.effect("a malformed lesson UUID fails before calling Google", () =>
    runCalendarJob({ lessonId: "not-a-uuid", gcalEventId: null }).pipe(
      Effect.provideService(GoogleCalendar, forbiddenGoogle),
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => expect(error._tag).toBe("SchemaError"))),
    ),
  );
});

type CalendarCall =
  | { method: "create"; event: Parameters<GoogleCalendar["Service"]["createEvent"]>[0] }
  | {
      method: "update";
      id: string;
      event: Parameters<GoogleCalendar["Service"]["updateEvent"]>[1];
    }
  | { method: "delete"; id: string };

const recordingCalendar = Effect.gen(function* () {
  const calls = yield* Ref.make<ReadonlyArray<CalendarCall>>([]);
  const calendar: GoogleCalendar["Service"] = {
    ...forbiddenGoogle,
    isConnected: () => Effect.succeed(true),
    createEvent: (event) =>
      Ref.update(calls, (all) => [...all, { method: "create", event } satisfies CalendarCall]).pipe(
        Effect.as(event.id),
      ),
    updateEvent: (id, event) =>
      Ref.update(calls, (all) => [...all, { method: "update", id, event } satisfies CalendarCall]),
    deleteEvent: (id) =>
      Ref.update(calls, (all) => [...all, { method: "delete", id } satisfies CalendarCall]),
  };
  return { calendar, calls: Ref.get(calls) };
});

const queuedJobs = Effect.fnUntraced(function* (lessonId: string) {
  const db = yield* PgRootDB;
  const rows = yield* db.execute(
    db
      .selectFrom(
        sql<{
          key: string;
          task_identifier: string;
          payload: string;
        }>`(select j.key, t.identifier as task_identifier, j.payload::text as payload from graphile_worker._private_jobs j join graphile_worker._private_tasks t on t.id = j.task_id)`.as(
          "jobs",
        ),
      )
      .select("payload")
      .where("key", "=", `lessons__sync_calendar_event:${lessonId}`)
      .where("task_identifier", "=", "lessons__sync_calendar_event"),
  );
  return yield* Effect.forEach(rows, (row) =>
    Schema.decodeEffect(Schema.fromJsonString(CalendarPayload))(row.payload),
  );
});

const createUser = (role: "admin" | "student") =>
  Effect.acquireRelease(
    PgRootDB.use((db) =>
      db
        .execute(
          db
            .insertInto("app_public.users")
            .values({
              username: sql<string>`'calendar_' || ${role} || '_' || gen_random_uuid()::text`,
              name: "Calendar Student",
              role,
            })
            .returning("id"),
        )
        .pipe(Effect.head),
    ),
    (user) =>
      PgRootDB.use((db) =>
        db.execute(db.deleteFrom("app_public.users").where("id", "=", user.id)),
      ).pipe(Effect.orDie),
  );

const removeJob = (lessonId: string) =>
  PgRootDB.use((db) =>
    db.execute(
      db.selectNoFrom(
        sql<string>`(graphile_worker.remove_job(${`lessons__sync_calendar_event:${lessonId}`})).id::text`.as(
          "id",
        ),
      ),
    ),
  );

const makeFixture = Effect.gen(function* () {
  const db = yield* PgRootDB;
  const admin = yield* createUser("admin");
  const student = yield* createUser("student");
  const session = yield* db
    .execute(db.insertInto("app_private.sessions").values({ user_id: admin.id }).returning("id"))
    .pipe(Effect.head);
  yield* db.execute(
    db.insertInto("app_public.student_rates").values({
      student_id: student.id,
      rate_cents: 5000,
      lesson_duration_minutes: 60,
      location_type: "online",
      billing_model: "monthly_prepaid",
    }),
  );
  const time = new Date(Date.now() + 365 * 86400000);
  const lesson = yield* db
    .execute(
      db
        .insertInto("app_public.lessons")
        .values({
          id: "123e4567-e89b-12d3-a456-426614174000",
          student_id: student.id,
          scheduled_at: time,
          duration_minutes: 60,
          location_type: "online",
          gcal_event_id: sql<string>`'calendar_event_' || gen_random_uuid()::text`,
        })
        .returning(["id", "gcal_event_id"]),
    )
    .pipe(Effect.head);
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const lessons = yield* db.execute(
        db.selectFrom("app_public.lessons").select("id").where("student_id", "=", student.id),
      );
      yield* db.execute(db.deleteFrom("app_public.lessons").where("student_id", "=", student.id));
      for (const id of new Set([lesson.id, ...lessons.map((row) => row.id)])) yield* removeJob(id);
    }).pipe(Effect.orDie),
  );
  yield* removeJob(lesson.id);
  return {
    db,
    adminId: admin.id,
    studentId: student.id,
    sessionId: session.id,
    lesson,
    nextTime: new Date(time.getTime() + 86400000),
  };
});

/** Invokes the registered job with the calendar dependency supplied by each scenario. */
const runCalendarJob = (input: unknown) =>
  WorkerTasks.use((tasks) => tasks.lessons__sync_calendar_event(input)).pipe(
    Effect.provide(
      WorkerTasks.layerNoDeps.pipe(
        Layer.provide(CalendarSync.layerNoDeps),
        Layer.provide(Layer.succeed(EmailDelivery, { send: () => Effect.void })),
      ),
    ),
  );
