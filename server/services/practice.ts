import { Effect, Context, Layer, Option } from "effect";
import { RequestDatabase } from "../requestDatabase.js";
import { HttpError } from "../pgErrors.js";

/** Practice logs and their ratings, and contact form submissions for staff. */
export class Practice extends Context.Service<Practice>()("dfg-rocks/practice", {
  make: Effect.sync(() => ({
    practiceLogs: Effect.fn("practiceLogs")(function* (materialId?: string, studentId?: string) {
      const db = yield* RequestDatabase;
      let query = db
        .selectFrom("app_public.practice_logs")
        .selectAll()
        .orderBy("logged_at", "desc");
      if (materialId) {
        query = query.where("material_id", "=", materialId);
      }
      if (studentId) {
        query = query.where("student_id", "=", studentId);
      }
      return yield* db.execute(query);
    }),
    createPracticeLog: Effect.fn("createPracticeLog")(function* (values: {
      studentId: string;
      materialId: string;
      rating?: number;
      durationMinutes?: number;
    }) {
      const db = yield* RequestDatabase;
      return yield* db
        .execute(
          db
            .insertInto("app_public.practice_logs")
            .values({
              student_id: values.studentId,
              material_id: values.materialId,
              rating: values.rating ?? null,
              duration_minutes: values.durationMinutes ?? null,
            })
            .returning([
              "id",
              "student_id",
              "material_id",
              "rating",
              "duration_minutes",
              "logged_at",
            ]),
        )
        .pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () =>
              new HttpError({ status: 500, message: "Failed to create practice log" }),
          }),
        );
    }),
    ratePracticeLog: Effect.fn("ratePracticeLog")(function* (
      studentId: string,
      materialId: string,
      rating: number,
    ) {
      const db = yield* RequestDatabase;
      const existing = yield* db
        .execute(
          db
            .selectFrom("app_public.practice_logs")
            .selectAll()
            .where("student_id", "=", studentId)
            .where("material_id", "=", materialId)
            .where("rating", "is", null)
            .orderBy("logged_at", "desc")
            .limit(1),
        )
        .pipe(Effect.head, Effect.option);

      if (Option.isSome(existing)) {
        return yield* db
          .execute(
            db
              .updateTable("app_public.practice_logs")
              .set({ rating })
              .where("id", "=", existing.value.id)
              .returning([
                "id",
                "student_id",
                "material_id",
                "rating",
                "duration_minutes",
                "logged_at",
              ]),
          )
          .pipe(
            Effect.head,
            Effect.catchTags({
              NoSuchElementError: () =>
                new HttpError({ status: 500, message: "Failed to update practice log" }),
            }),
          );
      }

      return yield* db
        .execute(
          db
            .insertInto("app_public.practice_logs")
            .values({
              student_id: studentId,
              material_id: materialId,
              rating,
            })
            .returning([
              "id",
              "student_id",
              "material_id",
              "rating",
              "duration_minutes",
              "logged_at",
            ]),
        )
        .pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () =>
              new HttpError({ status: 500, message: "Failed to create practice log" }),
          }),
        );
    }),
    practiceTakes: Effect.fn("practiceTakes")(function* (materialId: string, studentId?: string) {
      const db = yield* RequestDatabase;
      let query = db
        .selectFrom("app_public.practice_takes")
        .selectAll()
        .where("material_id", "=", materialId)
        .orderBy("taken_at", "asc");
      if (studentId) {
        query = query.where("student_id", "=", studentId);
      }
      return yield* db.execute(query);
    }),
    createPracticeTake: Effect.fn("createPracticeTake")(function* (values: {
      studentId: string;
      materialId: string;
      bpm: number;
      subdivision: number;
      notesHeard: number;
      onTimePct: number;
      meanOffsetMs: number;
      spreadMs: number;
    }) {
      const db = yield* RequestDatabase;
      return yield* db
        .execute(
          db
            .insertInto("app_public.practice_takes")
            .values({
              student_id: values.studentId,
              material_id: values.materialId,
              bpm: values.bpm,
              subdivision: values.subdivision,
              notes_heard: values.notesHeard,
              on_time_pct: values.onTimePct,
              mean_offset_ms: values.meanOffsetMs,
              spread_ms: values.spreadMs,
            })
            .returningAll(),
        )
        .pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () =>
              new HttpError({ status: 500, message: "Failed to save practice take" }),
          }),
        );
    }),
    /** The inbox leaves spam out; `spam: true` lists only the rows saved as spam. */
    listSubmissions: Effect.fn("listSubmissions")(function* (
      limit: number,
      offset: number,
      spam = false,
    ) {
      const db = yield* RequestDatabase;
      return yield* db.execute(
        db
          .selectFrom("app_public.contact_submissions")
          .selectAll()
          .where("spam_reason", spam ? "is not" : "is", null)
          .orderBy("created_at", "desc")
          .limit(limit)
          .offset(offset),
      );
    }),
    updateSubmissionRead: Effect.fn("updateSubmissionRead")(function* (
      id: string,
      isRead: boolean,
    ) {
      const db = yield* RequestDatabase;
      return yield* db
        .execute(
          db
            .updateTable("app_public.contact_submissions")
            .set({ is_read: isRead })
            .where("id", "=", id)
            .returning(["id"]),
        )
        .pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () =>
              new HttpError({ status: 404, message: "Contact submission not found" }),
          }),
        );
    }),
    /**
     * Moves a submission between the inbox and the spam list.
     *
     * The inbox leaves out every row whose `spam_reason` is set, so marking a row as spam
     * writes a reason and clearing it takes the reason away. A row marked as spam keeps its
     * reason: the reason says why it looked like spam, not that it is spam.
     */
    updateSubmissionSpam: Effect.fn("updateSubmissionSpam")(function* (
      id: string,
      isSpam: boolean,
      reason: string | null,
    ) {
      const db = yield* RequestDatabase;
      return yield* db
        .execute(
          db
            .updateTable("app_public.contact_submissions")
            .set({ spam_reason: isSpam ? (reason ?? "marked by the teacher") : null })
            .where("id", "=", id)
            .returning(["id", "spam_reason"]),
        )
        .pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () =>
              new HttpError({ status: 404, message: "Contact submission not found" }),
          }),
        );
    }),
  })),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
