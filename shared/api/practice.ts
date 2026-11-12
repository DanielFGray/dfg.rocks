import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Admin, Csrf, Session } from "./guards.js";
import { Schema as S } from "effect";
import { PracticeLog, Submission, SuccessResponse } from "../schemas.js";
import { params, PaginationQuery } from "./fields.js";
import { signedInErrors, adminErrors } from "../httpApiErrors.js";

const PracticeLogQuery = S.Struct({
  material_id: S.optional(S.String),
});

const UpdateSubmissionPayload = S.Struct({
  is_read: S.Boolean,
});

export const CreatePracticeLogPayload = S.Struct({
  material_id: S.String,
  rating: S.optional(S.Finite.pipe(S.check(S.isBetween({ minimum: 1, maximum: 5 })))),
  duration_minutes: S.optional(S.Finite),
});

export const RatePracticeLogPayload = S.Struct({
  material_id: S.String,
  rating: S.Finite.pipe(S.check(S.isBetween({ minimum: 1, maximum: 5 }))),
});

export const practiceGroup = HttpApiGroup.make("practice")
  .add(
    HttpApiEndpoint.get("practiceLogs", "/practice-logs", {
      error: signedInErrors,
      query: PracticeLogQuery,
      success: S.Array(PracticeLog),
    }),
  )
  .add(
    HttpApiEndpoint.post("createPracticeLog", "/practice-logs", {
      error: signedInErrors,
      payload: CreatePracticeLogPayload,
      success: PracticeLog,
    }),
  )
  .add(
    HttpApiEndpoint.post("ratePracticeLog", "/practice-logs/rate", {
      error: signedInErrors,
      payload: RatePracticeLogPayload,
      success: PracticeLog,
    }),
  )
  .middleware(Session)
  .prefix("/api");

export const practiceAdminGroup = HttpApiGroup.make("practiceAdmin")
  .add(
    HttpApiEndpoint.get("submissions", "/submissions", {
      error: adminErrors,
      query: PaginationQuery,
      success: S.Array(Submission),
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateSubmission", "/submissions/:id", {
      error: adminErrors,
      params: params("id"),
      payload: UpdateSubmissionPayload,
      success: SuccessResponse,
    }),
  )
  .middleware(Csrf)
  .middleware(Admin)
  .middleware(Session)
  .prefix("/api/admin");
