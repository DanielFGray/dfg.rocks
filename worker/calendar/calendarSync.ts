import { Context, Effect, Layer, Option, Schema } from "effect";
import { PgRootDB } from "../../server/db.js";
import { GoogleCalendar } from "../../server/services/googleCalendar.js";

export const CalendarSyncJob = Schema.Struct({
  lessonId: Schema.String.check(Schema.isUUID()),
  gcalEventId: Schema.NullOr(Schema.String),
});

/** Reconciles the committed lesson with Google; failures remain failures for worker retry. */
export class CalendarSync extends Context.Service<CalendarSync>()("dfg-rocks/calendarSync", {
  make: Effect.gen(function* () {
    const calendar = yield* GoogleCalendar;
    const db = yield* PgRootDB;
    return {
      sync: Effect.fn("CalendarSync.sync")(function* (job: typeof CalendarSyncJob.Type) {
        if (!(yield* calendar.isConnected())) {
          yield* Effect.logInfo("Calendar sync skipped: Google Calendar is not connected", {
            lessonId: job.lessonId,
          });
          return;
        }
        const result = yield* db
          .execute(
            db
              .selectFrom("app_public.lessons as l")
              .innerJoin("app_public.users as u", "u.id", "l.student_id")
              .select([
                "l.id",
                "l.status",
                "l.gcal_event_id",
                "l.scheduled_at",
                "l.duration_minutes",
                "l.location_type",
                "u.name",
                "u.username",
              ])
              .where("l.id", "=", job.lessonId),
          )
          .pipe(Effect.head, Effect.option);
        const lesson = Option.getOrNull(result);
        const stableEventId = `df9${job.lessonId.replaceAll("-", "").toLowerCase()}`;
        if (!lesson || lesson.status !== "scheduled") {
          // A create can reach Google before a concurrent delete commits, without its ID reaching the row.
          const eventId = lesson?.gcal_event_id ?? job.gcalEventId ?? stableEventId;
          yield* calendar.deleteEvent(eventId);
          yield* db.execute(
            db
              .updateTable("app_public.lessons")
              .set({ gcal_event_id: null })
              .where("id", "=", job.lessonId),
          );
          return;
        }
        const start = new Date(lesson.scheduled_at);
        const details = {
          summary: `Lesson: ${lesson.name || lesson.username}`,
          description: `${lesson.duration_minutes} min ${lesson.location_type.replaceAll("_", " ")} lesson`,
          start: start.toISOString(),
          end: new Date(start.getTime() + lesson.duration_minutes * 60000).toISOString(),
        };
        if (lesson.gcal_event_id) {
          yield* calendar.updateEvent(lesson.gcal_event_id, details);
        } else {
          const eventId = yield* calendar.createEvent({ id: stableEventId, ...details });
          yield* db.execute(
            db
              .updateTable("app_public.lessons")
              .set({ gcal_event_id: eventId })
              .where("id", "=", job.lessonId),
          );
        }
      }),
    };
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
  static readonly layer = this.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(GoogleCalendar.layer, PgRootDB.layer)),
  );
}
