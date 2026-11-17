import { Effect, Option, Context, Layer } from "effect";
import { RequestDatabase } from "../requestDatabase.js";
import { sql } from "kysely";
import { HttpError } from "../pgErrors.js";
import * as S from "effect/Schema";
import { Module, type RichTextDocument, Material } from "../../shared/schemas.js";
import { extractMaterialIds } from "../../shared/content.js";
import * as Struct from "effect/Struct";

/** Courses, their modules and enrollments. */
export class Courses extends Context.Service<Courses>()("dfg-rocks/courses", {
  make: Effect.sync(() => ({
    courses: Effect.fn("courses")(function* (studentId?: string) {
      const db = yield* RequestDatabase;
      let q = db
        .selectFrom("app_public.courses")
        .select(["id", "title", "description", "instrument"]);
      if (studentId) {
        q = q.where(sql<boolean>`app_public.can_read_course(id, ${studentId}::uuid)`);
      }
      return yield* db.execute(q);
    }),
    courseById: Effect.fn("courseById")(function* (courseId: string) {
      const db = yield* RequestDatabase;
      const rows = yield* db
        .execute(
          db
            .with("course_data", (qb) =>
              qb
                .selectFrom("app_public.courses")
                .select(["id", "title", "description", "instrument"])
                .where("id", "=", courseId),
            )
            .with("mods", (qb) =>
              qb
                .selectFrom("app_public.modules")
                .select(["id", "course_id", "title", "content", "sort_order"])
                .where("course_id", "=", courseId)
                .orderBy("sort_order"),
            )
            .with("mod_mats", (qb) =>
              qb
                .selectFrom("app_public.module_materials as mm")
                .innerJoin("app_public.materials as mat", "mat.id", "mm.material_id")
                .innerJoin("app_public.modules as mod", "mod.id", "mm.module_id")
                .where("mod.course_id", "=", courseId)
                .select((eb) => [
                  "mm.module_id",
                  "mat.id",
                  "mat.title",
                  "mat.original_filename",
                  "mat.mime_type",
                  eb.cast("mat.file_size", "integer").as("file_size"),
                  "mat.is_global",
                  "mat.notation_tracks",
                  "mm.sort_order",
                ])
                .orderBy("mm.sort_order"),
            )
            .selectFrom("course_data")
            .selectAll("course_data")
            .select((eb) => [
              eb.fn
                .coalesce(sql`(SELECT json_agg(row_to_json(mods.*)) FROM mods)`, sql`'[]'::json`)
                .as("modules_json"),
              eb.fn
                .coalesce(
                  sql`(SELECT json_agg(row_to_json(mod_mats.*)) FROM mod_mats)`,
                  sql`'[]'::json`,
                )
                .as("materials_json"),
            ]),
        )
        .pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () => new HttpError({ status: 404, message: "Course not found" }),
          }),
        );

      const modulesJson = yield* S.decodeUnknownEffect(S.Array(Module))(rows.modules_json);
      const materialsJson = yield* S.decodeUnknownEffect(S.Array(CourseMaterial))(
        rows.materials_json,
      );

      const matsByModule = new Map<string, S.Schema.Type<typeof CourseMaterial>[]>();
      for (const mat of materialsJson) {
        const list = matsByModule.get(mat.module_id) || [];
        list.push(mat);
        matsByModule.set(mat.module_id, list);
      }

      const { modules_json: _modules_json, materials_json: _materials_json, ...course } = rows;
      const modulesWithMaterials = modulesJson.map((mod) => ({
        ...mod,
        materials: matsByModule.get(mod.id) || [],
      }));

      return { ...course, modules: modulesWithMaterials };
    }),
    /**
     * Whether the course exists, whatever the caller may read. A caller asks after a course it cannot
     * read, to tell a locked course from a missing one. Runs in the caller's visitor transaction.
     */
    courseExists: Effect.fn("courseExists")(function* (courseId: string) {
      const db = yield* RequestDatabase;
      const rows = yield* db.execute(
        db.selectNoFrom(sql<boolean>`app_public.course_exists(${courseId}::uuid)`.as("exists")),
      );
      return rows[0]?.exists === true;
    }),

    listCourses: Effect.fn("listCourses")(function* () {
      const db = yield* RequestDatabase;
      return yield* db.execute(
        db.selectFrom("app_public.courses").select(["id", "title", "description", "instrument"]),
      );
    }),
    listCourseStudents: Effect.fn("listCourseStudents")(function* (courseId: string) {
      const db = yield* RequestDatabase;
      return yield* db.execute(
        db
          .selectFrom("app_public.enrollments as e")
          .innerJoin("app_public.users as u", "u.id", "e.student_id")
          .where("e.course_id", "=", courseId)
          .select(["u.id", "u.username", "u.name", "u.role", "u.is_verified"])
          .select((eb) =>
            eb
              .selectFrom("app_public.user_emails")
              .select("email")
              .whereRef("app_public.user_emails.user_id", "=", "u.id")
              .where("is_primary", "=", true)
              .as("email"),
          ),
      );
    }),
    createCourse: Effect.fn("createCourse")(function* (values: {
      title: string;
      description: string;
      instrument: string;
    }) {
      const db = yield* RequestDatabase;
      return yield* db
        .execute(
          db
            .insertInto("app_public.courses")
            .values(values)
            .returning(["id", "title", "description", "instrument"]),
        )
        .pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () =>
              new HttpError({ status: 500, message: "Failed to create course" }),
          }),
        );
    }),
    updateCourse: Effect.fn("updateCourse")(function* (
      id: string,
      updates: Partial<{
        title: string;
        description: string;
        instrument: string;
      }>,
    ) {
      const db = yield* RequestDatabase;
      return yield* db
        .execute(
          db
            .updateTable("app_public.courses")
            .set(updates)
            .where("id", "=", id)
            .returning(["id", "title", "description", "instrument"]),
        )
        .pipe(Effect.head, Effect.option, Effect.map(Option.getOrUndefined));
    }),
    deleteCourse: Effect.fn("deleteCourse")(function* (id: string) {
      const db = yield* RequestDatabase;
      yield* db.execute(db.deleteFrom("app_public.courses").where("id", "=", id));
    }),
    getModule: Effect.fn("getModule")(function* (id: string) {
      const db = yield* RequestDatabase;
      return yield* db
        .execute(
          db
            .selectFrom("app_public.modules")
            .select(["id", "course_id", "title", "content", "sort_order"])
            .where("id", "=", id),
        )
        .pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () => new HttpError({ status: 404, message: "Module not found" }),
          }),
          Effect.flatMap(S.decodeUnknownEffect(Module)),
        );
    }),
    createModule: Effect.fn("createModule")(function* (
      courseId: string,
      values: {
        title: string;
        sort_order: number;
      },
    ) {
      const db = yield* RequestDatabase;
      return yield* db
        .execute(
          db
            .insertInto("app_public.modules")
            .values({
              course_id: courseId,
              title: values.title,
              sort_order: values.sort_order,
            })
            .returning(["id", "course_id", "title", "content", "sort_order"]),
        )
        .pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () =>
              new HttpError({ status: 500, message: "Failed to create module" }),
          }),
          Effect.flatMap(S.decodeUnknownEffect(Module)),
        );
    }),
    updateModule: Effect.fn("updateModule")(function* (
      id: string,
      updates: {
        title?: string;
        sort_order?: number;
        content?: RichTextDocument | null;
      },
    ) {
      const moduleUpdates: Record<string, unknown> = {};
      if (updates.title !== undefined) {
        moduleUpdates.title = updates.title;
      }
      if (updates.content !== undefined) {
        moduleUpdates.content = updates.content ? JSON.stringify(updates.content) : null;
      }
      if (updates.sort_order !== undefined) {
        moduleUpdates.sort_order = updates.sort_order;
      }
      const db = yield* RequestDatabase;
      const mod = yield* db
        .execute(
          db
            .updateTable("app_public.modules")
            .set(moduleUpdates)
            .where("id", "=", id)
            .returning(["id", "course_id", "title", "content", "sort_order"]),
        )
        .pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () => new HttpError({ status: 404, message: "Module not found" }),
          }),
          Effect.flatMap(S.decodeUnknownEffect(Module)),
        );
      if (updates.content !== undefined) {
        const materialIds = updates.content === null ? [] : extractMaterialIds(updates.content);
        if (materialIds.length > 0) {
          yield* db.execute(
            db
              .deleteFrom("app_public.module_materials")
              .where("module_id", "=", id)
              .where("material_id", "not in", materialIds),
          );
        } else {
          yield* db.execute(
            db.deleteFrom("app_public.module_materials").where("module_id", "=", id),
          );
        }
        if (materialIds.length > 0) {
          yield* db.execute(
            db
              .insertInto("app_public.module_materials")
              .values(
                materialIds.map((materialId, index) => ({
                  module_id: id,
                  material_id: materialId,
                  sort_order: index,
                })),
              )
              .onConflict((oc) => oc.doNothing()),
          );
        }
      }
      return mod;
    }),
    deleteModule: Effect.fn("deleteModule")(function* (id: string) {
      const db = yield* RequestDatabase;
      yield* db.execute(db.deleteFrom("app_public.modules").where("id", "=", id));
    }),
    enrollStudent: Effect.fn("enrollStudent")(function* (studentId: string, courseId: string) {
      const db = yield* RequestDatabase;
      yield* db.execute(
        db
          .insertInto("app_public.enrollments")
          .values({
            student_id: studentId,
            course_id: courseId,
          })
          .onConflict((oc) => oc.doNothing()),
      );
    }),
    unenrollStudent: Effect.fn("unenrollStudent")(function* (studentId: string, courseId: string) {
      const db = yield* RequestDatabase;
      yield* db.execute(
        db
          .deleteFrom("app_public.enrollments")
          .where("student_id", "=", studentId)
          .where("course_id", "=", courseId),
      );
    }),
  })),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

const CourseMaterial = Material.mapFields(
  Struct.assign({
    module_id: S.String,
    sort_order: S.Finite,
  }),
);
