import { Effect, Option, Context, Layer } from "effect";
import { withAuthContext, type Database } from "../db.js";
import { resolveAssignedTrackIndex } from "./notationService.js";
import { HttpError } from "../pgErrors.js";
import { sql } from "kysely";

/** The material library, student assignments, playback and reviews. */
export class MaterialService extends Context.Service<MaterialService>()("MaterialService", {
  make: Effect.sync(() => ({
    library: Effect.fn("library")(function* (
      sessionId: string,
      values: {
        limit: number;
        offset: number;
      },
    ) {
      return yield* withAuthContext(sessionId, (db) =>
        db.execute(
          db
            .selectFrom("app_public.materials")
            .select((eb) => [
              "id",
              "title",
              "original_filename",
              "mime_type",
              eb.cast("file_size", "integer").as("file_size"),
              "is_global",
              "notation_tracks",
            ])
            .orderBy("created_at", "desc")
            .limit(values.limit)
            .offset(values.offset),
        ),
      );
    }),
    assignments: Effect.fn("assignments")(function* (sessionId: string, studentId?: string) {
      return yield* withAuthContext(sessionId, (db) => {
        let q = db
          .selectFrom("app_public.student_materials as sm")
          .innerJoin("app_public.materials as m", "m.id", "sm.material_id")
          .select((eb) => [
            "m.id",
            "m.title",
            "m.original_filename",
            "m.mime_type",
            eb.cast("m.file_size", "integer").as("file_size"),
            "m.is_global",
            "m.notation_tracks",
            "sm.assigned_track_index",
          ]);
        if (studentId) {
          q = q.where("sm.student_id", "=", studentId);
        }
        return db.execute(q);
      });
    }),
    assignStudentMaterial: Effect.fn("assignStudentMaterial")(function* (values: {
      sessionId: string;
      studentId: string;
      materialId: string;
      assignedTrackIndex?: number | null;
    }) {
      const assignedTrackIndex = yield* resolveAssignedTrackIndex(
        values.sessionId,
        values.materialId,
        values.assignedTrackIndex,
      );
      yield* withAuthContext(values.sessionId, (db) =>
        db.execute(
          db
            .insertInto("app_public.student_materials")
            .values({
              student_id: values.studentId,
              material_id: values.materialId,
              assigned_track_index: assignedTrackIndex,
            })
            .onConflict((oc) =>
              oc.columns(["student_id", "material_id"]).doUpdateSet({
                assigned_track_index: assignedTrackIndex,
              }),
            ),
        ),
      );
    }),
    unassignStudentMaterial: Effect.fn("unassignStudentMaterial")(function* (
      sessionId: string,
      studentId: string,
      materialId: string,
    ) {
      yield* withAuthContext(sessionId, (db) =>
        db.execute(
          db
            .deleteFrom("app_public.student_materials")
            .where("student_id", "=", studentId)
            .where("material_id", "=", materialId),
        ),
      );
    }),
    recordAssignmentPlayback: Effect.fn("recordAssignmentPlayback")(function* (values: {
      sessionId: string;
      studentId: string;
      materialId: string;
      seconds: number;
    }) {
      return yield* withAuthContext(
        values.sessionId,
        Effect.fnUntraced(function* (db) {
          yield* assertAssignedMaterial(db, values.materialId);
          return yield* db
            .execute(
              db
                .insertInto("app_public.assignment_progress")
                .values((eb) => ({
                  student_id: values.studentId,
                  material_id: values.materialId,
                  listened_seconds: values.seconds,
                  last_played_at: eb.fn("now", []),
                  updated_at: eb.fn("now", []),
                }))
                .onConflict((oc) =>
                  oc.columns(["student_id", "material_id"]).doUpdateSet((eb) => ({
                    listened_seconds: eb(
                      eb.ref("app_public.assignment_progress.listened_seconds"),
                      "+",
                      values.seconds,
                    ),
                    last_played_at: eb.fn("now", []),
                    updated_at: eb.fn("now", []),
                  })),
                )
                .returning(["material_id", "listened_seconds", "updated_at"]),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () =>
                  new HttpError(500, "Failed to record assignment playback"),
              }),
            );
        }),
      );
    }),
    createAssignmentReview: Effect.fn("createAssignmentReview")(function* (values: {
      sessionId: string;
      studentId: string;
      materialId: string;
      stars: number;
    }) {
      return yield* withAuthContext(
        values.sessionId,
        Effect.fnUntraced(function* (db) {
          const row = yield* db
            .execute(
              db
                .selectFrom("app_public.student_materials as sm")
                .leftJoin(
                  "app_public.assignment_progress as ap",
                  "ap.material_id",
                  "sm.material_id",
                )
                .select(["sm.material_id", "ap.listened_seconds"])
                .where("sm.material_id", "=", values.materialId),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(404, "Assignment not found"),
              }),
            );

          return yield* db
            .execute(
              db
                .insertInto("app_public.assignment_reviews")
                .values({
                  student_id: values.studentId,
                  material_id: values.materialId,
                  stars: values.stars,
                  listened_seconds: row.listened_seconds ?? 0,
                })
                .returning(["id", "material_id", "stars", "listened_seconds", "created_at"]),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(500, "Failed to create assignment review"),
              }),
            );
        }),
      );
    }),
    assignmentNotes: Effect.fn("assignmentNotes")(function* (
      sessionId: string,
      materialId: string,
    ) {
      return yield* withAuthContext(sessionId, (db) =>
        db
          .execute(
            db
              .selectFrom("app_public.assignment_notes")
              .selectAll()
              .where("material_id", "=", materialId),
          )
          .pipe(Effect.head, Effect.option, Effect.map(Option.getOrNull)),
      );
    }),
    upsertAssignmentNotes: Effect.fn("upsertAssignmentNotes")(function* (values: {
      sessionId: string;
      studentId: string;
      materialId: string;
      body: string;
    }) {
      return yield* withAuthContext(
        values.sessionId,
        Effect.fnUntraced(function* (db) {
          return yield* db
            .execute(
              db
                .insertInto("app_public.assignment_notes")
                .values({
                  student_id: values.studentId,
                  material_id: values.materialId,
                  body: values.body,
                })
                .onConflict((oc) =>
                  oc.columns(["student_id", "material_id"]).doUpdateSet({
                    body: values.body,
                    updated_at: sql`now()`,
                  }),
                )
                .returning(["id", "student_id", "material_id", "body", "created_at", "updated_at"]),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(500, "Failed to save assignment notes"),
              }),
            );
        }),
      );
    }),
    assignMaterial: Effect.fn("assignMaterial")(function* (values: {
      sessionId: string;
      studentId: string;
      materialId: string;
      assignedTrackIndex: number | string | null | undefined;
    }) {
      const resolvedTrackIndex = yield* resolveAssignedTrackIndex(
        values.sessionId,
        values.materialId,
        values.assignedTrackIndex,
      );
      yield* withAuthContext(values.sessionId, (db) =>
        db.execute(
          db
            .insertInto("app_public.student_materials")
            .values({
              student_id: values.studentId,
              material_id: values.materialId,
              assigned_track_index: resolvedTrackIndex,
            })
            .onConflict((oc) =>
              oc.columns(["student_id", "material_id"]).doUpdateSet({
                assigned_track_index: resolvedTrackIndex,
              }),
            ),
        ),
      );
    }),
    unassignMaterial: Effect.fn("unassignMaterial")(function* (
      sessionId: string,
      studentId: string,
      materialId: string,
    ) {
      yield* withAuthContext(sessionId, (db) =>
        db.execute(
          db
            .deleteFrom("app_public.student_materials")
            .where("student_id", "=", studentId)
            .where("material_id", "=", materialId),
        ),
      );
    }),
    deleteMaterial: Effect.fn("deleteMaterial")(function* (sessionId: string, id: string) {
      return yield* withAuthContext(sessionId, (db) =>
        db.execute(db.deleteFrom("app_public.materials").where("id", "=", id).returning("id")).pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () => new HttpError(404, "Material not found"),
          }),
        ),
      );
    }),
  })),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

function assertAssignedMaterial(db: Database, materialId: string) {
  return db
    .execute(
      db
        .selectFrom("app_public.student_materials")
        .select("material_id")
        .where("material_id", "=", materialId),
    )
    .pipe(
      Effect.head,
      Effect.catchTags({
        NoSuchElementError: () => new HttpError(404, "Assignment not found"),
      }),
    );
}
