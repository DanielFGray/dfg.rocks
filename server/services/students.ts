import { Effect, Context, Layer } from "effect";
import type { BillingModel, LocationType } from "../../shared/schemas.js";
import { RequestDatabase } from "../requestDatabase.js";
import { HttpError } from "../pgErrors.js";

/** Learner-only work: the rates a learner is billed at. Accounts in general live in People. */
export class Students extends Context.Service<Students>()("dfg-rocks/students", {
  make: Effect.succeed({
    saveStudentRate: Effect.fn("saveStudentRate")(function* (values: {
      studentId: string;
      rateCents: number;
      lessonDurationMinutes: number;
      locationType: LocationType;
      billingModel: BillingModel;
      notes: string | null;
    }) {
      const db = yield* RequestDatabase;
      return yield* db
        .execute(
          db
            .insertInto("app_public.student_rates")
            .values({
              student_id: values.studentId,
              rate_cents: values.rateCents,
              lesson_duration_minutes: values.lessonDurationMinutes,
              location_type: values.locationType,
              billing_model: values.billingModel,
              notes: values.notes,
            })
            .onConflict((oc) =>
              oc.columns(["student_id", "location_type"]).doUpdateSet({
                rate_cents: values.rateCents,
                lesson_duration_minutes: values.lessonDurationMinutes,
                billing_model: values.billingModel,
                notes: values.notes,
              }),
            )
            .returning([
              "id",
              "student_id",
              "rate_cents",
              "lesson_duration_minutes",
              "location_type",
              "billing_model",
              "notes",
              "created_at",
            ]),
        )
        .pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () =>
              new HttpError({ status: 500, message: "Failed to save student rate" }),
          }),
        );
    }),
    listStudentRates: Effect.fn("listStudentRates")(function* (
      studentId: string,
      locationType?: LocationType,
    ) {
      const db = yield* RequestDatabase;
      let query = db
        .selectFrom("app_public.student_rates")
        .select([
          "id",
          "student_id",
          "rate_cents",
          "lesson_duration_minutes",
          "location_type",
          "billing_model",
          "notes",
          "created_at",
        ])
        .where("student_id", "=", studentId);
      if (locationType) query = query.where("location_type", "=", locationType);
      return yield* db.execute(query);
    }),
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
