// @ts-check
/** @typedef {import("graphile-worker").Task} Task */
import { ensureLessonEvent } from "../helpers/googleCalendar.js";

/** @typedef {{ lessonId: string }} EnsureLessonEventPayload */

/** @type {Task} */
export default async (inPayload, { withPgClient, logger }) => {
  const { lessonId } = /** @type {EnsureLessonEventPayload} */ (inPayload);
  if (typeof lessonId !== "string" || lessonId.length === 0) {
    throw new Error("gcal__ensure_lesson_event requires lessonId");
  }

  await withPgClient(async (pgClient) => {
    const {
      rows: [lesson],
    } = await pgClient.query(
      `select l.id,
              l.gcal_event_id,
              l.scheduled_at,
              l.duration_minutes,
              l.location_type,
              l.status,
              u.name as student_name
         from app_public.lessons l
         join app_public.users u on u.id = l.student_id
        where l.id = $1`,
      [lessonId],
    );

    if (!lesson) throw new Error(`Lesson ${lessonId} was not found`);
    if (lesson.gcal_event_id) return;
    if (lesson.status !== "scheduled") {
      logger.info(`gcal__ensure_lesson_event: lesson ${lessonId} is ${lesson.status}; skipping`);
      return;
    }

    const eventId = await ensureLessonEvent({ pgClient, lesson });
    await pgClient.query(
      `update app_public.lessons
          set gcal_event_id = $2
        where id = $1
          and gcal_event_id is null`,
      [lessonId, eventId],
    );
    logger.info(`gcal__ensure_lesson_event: confirmed ${eventId} for lesson ${lessonId}`);
  });
};
