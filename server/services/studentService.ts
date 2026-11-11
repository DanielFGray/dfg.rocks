import { Effect, Context, Layer } from "effect";
import * as S from "effect/Schema";
import { sql } from "kysely";
import { EnrolledCourse, AssignedMaterial } from "../../shared/schemas.js";
import type { BillingModel, LocationType } from "../../shared/schemas.js";
import { withAuthContext } from "../db.js";
import { HttpError } from "../pgErrors.js";

export class StudentService extends Context.Service<StudentService>()("StudentService", {
  make: Effect.succeed({
    listStudents: Effect.fn("listStudents")(function* (sessionId: string) {
      return yield* withAuthContext(sessionId, (db) =>
        db.execute(
          db
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
            .where("role", "=", "student"),
        ),
      );
    }),
    getStudent: Effect.fn("getStudent")(function* (sessionId: string, studentId: string) {
      const row = yield* withAuthContext(sessionId, (db) =>
        db
          .execute(
            db
              .with("s", (qb) =>
                qb
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
                  .where("id", "=", studentId)
                  .where("role", "=", "student"),
              )
              .with("c", (qb) =>
                qb
                  .selectFrom("app_public.enrollments as e")
                  .innerJoin("app_public.courses as c", "c.id", "e.course_id")
                  .where("e.student_id", "=", studentId)
                  .select(["c.id", "c.title", "c.instrument"]),
              )
              .with("m", (qb) =>
                qb
                  .selectFrom("app_public.student_materials as sm")
                  .innerJoin("app_public.materials as m", "m.id", "sm.material_id")
                  .leftJoin("app_public.assignment_progress as ap", (join) =>
                    join
                      .onRef("ap.material_id", "=", "sm.material_id")
                      .onRef("ap.student_id", "=", "sm.student_id"),
                  )
                  .where("sm.student_id", "=", studentId)
                  .select((eb) => [
                    "m.id",
                    "m.title",
                    "m.original_filename",
                    "m.mime_type",
                    eb.cast("m.file_size", "integer").as("file_size"),
                    "m.is_global",
                    "m.notation_tracks",
                    "sm.assigned_track_index",
                    eb.fn.coalesce("ap.listened_seconds", eb.val(0)).as("listened_seconds"),
                  ]),
              )
              .selectFrom("s")
              .selectAll("s")
              .select((eb) => [
                eb.fn
                  .coalesce(
                    eb
                      .selectFrom("c")
                      .select(eb.fn.jsonAgg(eb.fn("row_to_json", [sql`c.*`])).as("_")),
                    sql`'[]'::json`,
                  )
                  .as("enrolled_courses"),
                eb.fn
                  .coalesce(
                    eb
                      .selectFrom("m")
                      .select(eb.fn.jsonAgg(eb.fn("row_to_json", [sql`m.*`])).as("_")),
                    sql`'[]'::json`,
                  )
                  .as("assigned_materials"),
              ]),
          )
          .pipe(
            Effect.head,
            Effect.catchTags({
              NoSuchElementError: () => new HttpError(404, "Student not found"),
            }),
          ),
      );
      const enrolledCourses = yield* S.decodeUnknownEffect(S.Array(EnrolledCourse))(
        row.enrolled_courses,
      );
      const assignedMaterials = yield* S.decodeUnknownEffect(S.Array(AssignedMaterial))(
        row.assigned_materials,
      );
      return {
        ...row,
        enrolled_courses: enrolledCourses,
        assigned_materials: assignedMaterials,
      };
    }),
    saveStudentRate: Effect.fn("saveStudentRate")(function* (values: {
      sessionId: string;
      studentId: string;
      rateCents: number;
      lessonDurationMinutes: number;
      locationType: LocationType;
      billingModel: BillingModel;
      notes: string | null;
    }) {
      return yield* withAuthContext(values.sessionId, (db) =>
        db
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
              NoSuchElementError: () => new HttpError(500, "Failed to save student rate"),
            }),
          ),
      );
    }),
    listStudentRates: Effect.fn("listStudentRates")(function* (
      sessionId: string,
      studentId: string,
      locationType?: LocationType,
    ) {
      return yield* withAuthContext(sessionId, (db) => {
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
        return db.execute(query);
      });
    }),
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
