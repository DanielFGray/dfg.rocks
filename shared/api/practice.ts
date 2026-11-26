import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Admin, Csrf, Session } from "./guards.js";
import { Schema as S } from "effect";
import { PracticeLog, PracticeTake, Submission, SuccessResponse } from "../schemas.js";
import { params, PaginationQuery } from "./fields.js";
import { signedInErrors, adminErrors } from "../httpApiErrors.js";

const PracticeLogQuery = S.Struct({
  material_id: S.optional(S.String),
});

const PracticeTakeQuery = S.Struct({
  material_id: S.String,
  student_id: S.optional(S.String),
});

const SubmissionsQuery = S.Struct({
  ...PaginationQuery.fields,
  // "true" lists only the submissions saved as spam; otherwise they are left out.
  spam: S.optional(S.Literals(["true", "false"])),
});

const UpdateSubmissionPayload = S.Struct({
  is_read: S.Boolean,
});

/**
 * Marks a submission as spam, or takes it out of the spam list.
 *
 * `is_spam` decides which list the row sits in. `reason` says why a row looks like spam, and
 * is kept on the row when the row is marked as spam.
 */
const UpdateSubmissionSpamPayload = S.Struct({
  is_spam: S.Boolean,
  reason: S.optional(S.String),
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

const PositiveInt = S.Int.pipe(S.check(S.isGreaterThan(0)));

/** A Listen take: bpm, subdivision and how closely the played notes matched the click. */
export const CreatePracticeTakePayload = S.Struct({
  material_id: S.String,
  bpm: S.Finite.pipe(S.check(S.isGreaterThan(0))),
  subdivision: PositiveInt,
  notes_heard: S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0))),
  on_time_pct: S.Finite.pipe(S.check(S.isBetween({ minimum: 0, maximum: 100 }))),
  mean_offset_ms: S.Finite,
  spread_ms: S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(0))),
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
  .add(
    HttpApiEndpoint.get("practiceTakes", "/practice-takes", {
      error: signedInErrors,
      query: PracticeTakeQuery,
      success: S.Array(PracticeTake),
    }),
  )
  .add(
    HttpApiEndpoint.post("createPracticeTake", "/practice-takes", {
      error: signedInErrors,
      payload: CreatePracticeTakePayload,
      success: PracticeTake,
    }),
  )
  .middleware(Session)
  .prefix("/api");

export const practiceAdminGroup = HttpApiGroup.make("practiceAdmin")
  .add(
    HttpApiEndpoint.get("submissions", "/submissions", {
      error: adminErrors,
      query: SubmissionsQuery,
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
  .add(
    HttpApiEndpoint.patch("updateSubmissionSpam", "/submissions/:id/spam", {
      error: adminErrors,
      params: params("id"),
      payload: UpdateSubmissionSpamPayload,
      success: SuccessResponse,
    }),
  )
  .middleware(Csrf)
  .middleware(Admin)
  .middleware(Session)
  .prefix("/api/admin");
