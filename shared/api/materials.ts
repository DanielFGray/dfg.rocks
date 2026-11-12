import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Admin, Csrf, Session } from "./guards.js";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as Multipart from "effect/http/Multipart";
import { Schema as S } from "effect";
import {
  BooleanFromString,
  AssignedMaterial,
  AssignmentNote,
  AssignmentProgress,
  AssignmentReview,
  Material,
  SuccessResponse,
} from "../schemas.js";
import {
  ForbiddenErrorSchema,
  InternalServerErrorSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  signedInErrors,
  adminErrors,
} from "../httpApiErrors.js";
import { params, PaginationQuery } from "./fields.js";

const AssignStudentMaterialPayload = S.Struct({
  material_id: S.String,
  assigned_track_index: S.optional(S.NullishOr(S.Finite)),
});

const RecordAssignmentPlaybackPayload = S.Struct({
  seconds: S.Finite,
});

const CreateAssignmentReviewPayload = S.Struct({
  stars: S.Finite,
});

const AssignmentNotePayload = S.Struct({
  body: S.String,
});

const UploadMaterialPayload = S.Struct({
  file: Multipart.SingleFileSchema,
  title: S.String,
  is_global: BooleanFromString,
}).pipe(HttpApiSchema.asMultipart());

export const materialsGroup = HttpApiGroup.make("materials")
  .add(
    HttpApiEndpoint.get("library", "/library", {
      error: signedInErrors,
      query: PaginationQuery,
      success: S.Array(Material),
    }),
  )
  .add(
    HttpApiEndpoint.get("assignments", "/assignments", {
      error: signedInErrors,
      success: S.Array(AssignedMaterial),
    }),
  )
  .add(
    HttpApiEndpoint.post("assignStudentMaterial", "/assignments/students/:studentId/assign", {
      error: signedInErrors,
      params: params("studentId"),
      payload: AssignStudentMaterialPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete(
      "unassignStudentMaterial",
      "/assignments/students/:studentId/assign/:materialId",
      {
        error: signedInErrors,
        params: params("studentId", "materialId"),
        success: SuccessResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("recordAssignmentPlayback", "/assignments/:materialId/playback", {
      error: signedInErrors,
      params: params("materialId"),
      payload: RecordAssignmentPlaybackPayload,
      success: AssignmentProgress,
    }),
  )
  .add(
    HttpApiEndpoint.post("createAssignmentReview", "/assignments/:materialId/reviews", {
      error: signedInErrors,
      params: params("materialId"),
      payload: CreateAssignmentReviewPayload,
      success: AssignmentReview,
    }),
  )
  .add(
    HttpApiEndpoint.get("assignmentNotes", "/assignments/:materialId/notes", {
      error: signedInErrors,
      params: params("materialId"),
      success: S.NullOr(AssignmentNote),
    }),
  )
  .add(
    HttpApiEndpoint.put("upsertAssignmentNotes", "/assignments/:materialId/notes", {
      error: signedInErrors,
      params: params("materialId"),
      payload: AssignmentNotePayload,
      success: AssignmentNote,
    }),
  )
  .add(
    HttpApiEndpoint.get("materialDownload", "/materials/:id/download", {
      error: [
        UnauthorizedErrorSchema,
        ForbiddenErrorSchema,
        NotFoundErrorSchema,
        InternalServerErrorSchema,
      ],
      params: params("id"),
    }),
  )
  .middleware(Session)
  .prefix("/api");

export const materialsAdminGroup = HttpApiGroup.make("materialsAdmin")
  .add(
    HttpApiEndpoint.post("assignMaterial", "/students/:id/assign", {
      error: adminErrors,
      params: params("id"),
      payload: AssignStudentMaterialPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("unassignMaterial", "/students/:id/assign/:materialId", {
      error: adminErrors,
      params: params("id", "materialId"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteMaterial", "/materials/:id", {
      error: adminErrors,
      params: params("id"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("uploadMaterial", "/materials/upload", {
      error: adminErrors,
      payload: UploadMaterialPayload,
      success: Material,
    }),
  )
  .middleware(Csrf)
  .middleware(Admin)
  .middleware(Session)
  .prefix("/api/admin");
