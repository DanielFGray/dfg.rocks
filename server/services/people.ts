import { Effect, Context, Layer } from "effect";
import * as S from "effect/Schema";
import { sql } from "kysely";
import {
  AssignedMaterial,
  EnrolledCourse,
  type User,
  type UserRole,
} from "../../shared/schemas.js";
import { RequestDatabase } from "../requestDatabase.js";
import { HttpError, catchPgErrors } from "../pgErrors.js";

/**
 * Every account, whatever its role. Callers that need learners pass "student" to listPeople;
 * learner-only work (rates, enrollments) lives in Students.
 */
export class People extends Context.Service<People>()("dfg-rocks/people", {
  make: Effect.succeed({
    /** Every account, or only the accounts in `role`. */
    listPeople: Effect.fn("listPeople")(function* (role?: UserRole) {
      const db = yield* RequestDatabase;
      let query = db
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
        );
      if (role) query = query.where("role", "=", role);
      return yield* db.execute(query);
    }),
    /**
     * One account with its learner fields. The learner lists are empty for a non-student, so the
     * page hides those sections.
     */
    getPerson: Effect.fn("getPerson")(function* (personId: string) {
      const db = yield* RequestDatabase;
      const row = yield* db
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
                .where("id", "=", personId),
            )
            .with("c", (qb) =>
              qb
                .selectFrom("app_public.enrollments as e")
                .innerJoin("app_public.courses as c", "c.id", "e.course_id")
                .where("e.student_id", "=", personId)
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
                .where("sm.student_id", "=", personId)
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
            NoSuchElementError: () => new HttpError({ status: 404, message: "Account not found" }),
          }),
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
    /** The families a person belongs to, with the person's flags in each. */
    personFamilies: Effect.fn("personFamilies")(function* (personId: string) {
      const db = yield* RequestDatabase;
      return yield* db.execute(
        db
          .selectFrom("app_public.family_memberships as fm")
          .innerJoin("app_public.families as f", "f.id", "fm.family_id")
          .select(["f.id", "f.name", "fm.is_owner", "fm.is_billing_contact"])
          .where("fm.user_id", "=", personId)
          .orderBy("f.name"),
      );
    }),
    /**
     * Sets an account's role through app_public.set_user_role. That function refuses a non-admin
     * caller and a self-change. It keeps at least one admin through its lock order, so this method
     * does not check the last admin. The family billing rule runs at commit, so its BLCNT refusal
     * comes from the same transaction.
     */
    setUserRole: Effect.fn("setUserRole")(function* (userId: string, role: UserRole) {
      const db = yield* RequestDatabase;
      return yield* db
        .execute(
          db
            .selectFrom(
              sql<
                Pick<User, "id" | "role">
              >`app_public.set_user_role(${userId}::uuid, ${role}::app_public.user_role)`.as("u"),
            )
            .selectAll(),
        )
        .pipe(Effect.head, catchPgErrors);
    }),
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
