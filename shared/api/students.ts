import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Admin, Csrf, Session, Staff } from "./guards.js";
import { Schema as S } from "effect";
import { BillingModel, LocationType, StudentDetail, StudentRate, User } from "../schemas.js";
import { params } from "./fields.js";
import { adminErrors } from "../httpApiErrors.js";

export const SaveStudentRatePayload = S.Struct({
  student_id: S.String,
  rate_cents: S.Number.pipe(S.check(S.isInt()), S.check(S.isGreaterThan(0))),
  lesson_duration_minutes: S.Literals([30, 60]),
  location_type: LocationType,
  billing_model: BillingModel,
  notes: S.optional(S.String),
});

export const StudentRatesQuery = S.Struct({
  location_type: S.optional(LocationType),
});

export const studentsStaffGroup = HttpApiGroup.make("studentsStaff")
  .add(
    HttpApiEndpoint.get("students", "/students", {
      error: adminErrors,
      success: S.Array(User),
    }),
  )
  .add(
    HttpApiEndpoint.get("student", "/students/:id", {
      error: adminErrors,
      params: params("id"),
      success: StudentDetail,
    }),
  )
  .middleware(Staff)
  .middleware(Session)
  .prefix("/api/admin");

export const studentsAdminGroup = HttpApiGroup.make("studentsAdmin")
  .add(
    HttpApiEndpoint.post("saveStudentRate", "/student-rates", {
      error: adminErrors,
      payload: SaveStudentRatePayload,
      success: StudentRate,
    }),
  )
  .add(
    HttpApiEndpoint.get("studentRates", "/student-rates/:studentId", {
      error: adminErrors,
      params: params("studentId"),
      query: StudentRatesQuery,
      success: S.Array(StudentRate),
    }),
  )
  .middleware(Csrf)
  .middleware(Admin)
  .middleware(Session)
  .prefix("/api/admin");
