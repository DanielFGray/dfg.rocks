import { Effect, Context, Layer } from "effect";
import { RequestDatabase } from "../requestDatabase.js";
import { HttpError } from "../pgErrors.js";

/** Practice logs and their ratings, and contact form submissions for staff. */
export class PracticeService extends Context.Service<PracticeService>()("PracticeService", {
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
            NoSuchElementError: () => new HttpError(500, "Failed to create practice log"),
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
        .pipe(Effect.head);

      if (existing) {
        return yield* db
          .execute(
            db
              .updateTable("app_public.practice_logs")
              .set({ rating })
              .where("id", "=", existing.id)
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
              NoSuchElementError: () => new HttpError(500, "Failed to update practice log"),
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
            NoSuchElementError: () => new HttpError(500, "Failed to create practice log"),
          }),
        );
    }),
    listSubmissions: Effect.fn("listSubmissions")(function* (limit: number, offset: number) {
      const db = yield* RequestDatabase;
      return yield* db.execute(
        db
          .selectFrom("app_public.contact_submissions")
          .selectAll()
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
            NoSuchElementError: () => new HttpError(404, "Contact submission not found"),
          }),
        );
    }),
  })),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
