import { Effect, Option, Context, Layer } from "effect";
import type { Database } from "../db.js";
import { RequestDatabase } from "../requestDatabase.js";
import { resolveAssignedTrackIndex } from "./notationService.js";
import { HttpError } from "../pgErrors.js";
import { sql } from "kysely";

/** The material library, student assignments, playback and reviews. */
export class Materials extends Context.Service<Materials>()("dfg-rocks/materials", {
  make: Effect.sync(() => ({
    library: Effect.fn("library")(function* (values: { limit: number; offset: number }) {
      const db = yield* RequestDatabase;
      return yield* db.execute(
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
      );
    }),
    assignments: Effect.fn("assignments")(function* (studentId?: string) {
      const db = yield* RequestDatabase;
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
      return yield* db.execute(q);
    }),
    assignStudentMaterial: Effect.fn("assignStudentMaterial")(function* (values: {
      studentId: string;
      materialId: string;
      assignedTrackIndex?: number | null;
    }) {
      const db = yield* RequestDatabase;
      const material = yield* db
        .execute(
          db
            .selectFrom("app_public.materials")
            .select(["id", "notation_tracks"])
            .where("id", "=", values.materialId),
        )
        .pipe(
          Effect.head,
          Effect.catchTag(
            "NoSuchElementError",
            () => new HttpError({ status: 404, message: "Material not found" }),
          ),
        );
      const assignedTrackIndex = yield* resolveAssignedTrackIndex(
        material.notation_tracks,
        values.assignedTrackIndex,
      );
      yield* db.execute(
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
      );
    }),
    unassignStudentMaterial: Effect.fn("unassignStudentMaterial")(function* (
      studentId: string,
      materialId: string,
    ) {
      const db = yield* RequestDatabase;
      yield* db.execute(
        db
          .deleteFrom("app_public.student_materials")
          .where("student_id", "=", studentId)
          .where("material_id", "=", materialId),
      );
    }),
    recordAssignmentPlayback: Effect.fn("recordAssignmentPlayback")(function* (values: {
      studentId: string;
      materialId: string;
      seconds: number;
    }) {
      const db = yield* RequestDatabase;
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
              new HttpError({ status: 500, message: "Failed to record assignment playback" }),
          }),
        );
    }),
    createAssignmentReview: Effect.fn("createAssignmentReview")(function* (values: {
      studentId: string;
      materialId: string;
      stars: number;
    }) {
      const db = yield* RequestDatabase;
      const row = yield* db
        .execute(
          db
            .selectFrom("app_public.student_materials as sm")
            .leftJoin("app_public.assignment_progress as ap", "ap.material_id", "sm.material_id")
            .select(["sm.material_id", "ap.listened_seconds"])
            .where("sm.material_id", "=", values.materialId),
        )
        .pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () =>
              new HttpError({ status: 404, message: "Assignment not found" }),
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
            NoSuchElementError: () =>
              new HttpError({ status: 500, message: "Failed to create assignment review" }),
          }),
        );
    }),
    assignmentNotes: Effect.fn("assignmentNotes")(function* (materialId: string) {
      const db = yield* RequestDatabase;
      return yield* db
        .execute(
          db
            .selectFrom("app_public.assignment_notes")
            .selectAll()
            .where("material_id", "=", materialId),
        )
        .pipe(Effect.head, Effect.option, Effect.map(Option.getOrNull));
    }),
    upsertAssignmentNotes: Effect.fn("upsertAssignmentNotes")(function* (values: {
      studentId: string;
      materialId: string;
      body: string;
    }) {
      const db = yield* RequestDatabase;
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
            NoSuchElementError: () =>
              new HttpError({ status: 500, message: "Failed to save assignment notes" }),
          }),
        );
    }),
    assignMaterial: Effect.fn("assignMaterial")(function* (values: {
      studentId: string;
      materialId: string;
      assignedTrackIndex: number | string | null | undefined;
    }) {
      const db = yield* RequestDatabase;
      const material = yield* db
        .execute(
          db
            .selectFrom("app_public.materials")
            .select(["id", "notation_tracks"])
            .where("id", "=", values.materialId),
        )
        .pipe(
          Effect.head,
          Effect.catchTag(
            "NoSuchElementError",
            () => new HttpError({ status: 404, message: "Material not found" }),
          ),
        );
      const resolvedTrackIndex = yield* resolveAssignedTrackIndex(
        material.notation_tracks,
        values.assignedTrackIndex,
      );
      yield* db.execute(
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
      );
    }),
    unassignMaterial: Effect.fn("unassignMaterial")(function* (
      studentId: string,
      materialId: string,
    ) {
      const db = yield* RequestDatabase;
      yield* db.execute(
        db
          .deleteFrom("app_public.student_materials")
          .where("student_id", "=", studentId)
          .where("material_id", "=", materialId),
      );
    }),
    deleteMaterial: Effect.fn("deleteMaterial")(function* (id: string) {
      const db = yield* RequestDatabase;
      return yield* db
        .execute(db.deleteFrom("app_public.materials").where("id", "=", id).returning("id"))
        .pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () => new HttpError({ status: 404, message: "Material not found" }),
          }),
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
        NoSuchElementError: () => new HttpError({ status: 404, message: "Assignment not found" }),
      }),
    );
}
