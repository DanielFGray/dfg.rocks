import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Schema as S } from "effect";
import {
  Course,
  CourseDetail,
  RichTextDocument,
  Module,
  User,
  SuccessResponse,
} from "../schemas.js";
import { params } from "./fields.js";
import { signedInErrors, adminErrors } from "../httpApiErrors.js";

const CreateCoursePayload = S.Struct({
  title: S.String,
  description: S.optional(S.String),
  instrument: S.String,
});

const UpdateCoursePayload = S.Struct({
  title: S.optional(S.String),
  description: S.optional(S.String),
  instrument: S.optional(S.String),
});

const CreateModulePayload = S.Struct({
  title: S.String,
  sort_order: S.optional(S.Number),
});

const UpdateModulePayload = S.Struct({
  title: S.optional(S.String),
  content: S.optional(S.NullOr(RichTextDocument)),
  sort_order: S.optional(S.Number),
});

const EnrollStudentPayload = S.Struct({
  course_id: S.String,
});

export const coursesGroup = HttpApiGroup.make("courses")
  .add(
    HttpApiEndpoint.get("courses", "/courses", {
      error: signedInErrors,
      success: S.Array(Course),
    }),
  )
  .add(
    HttpApiEndpoint.get("courseById", "/courses/:id", {
      error: signedInErrors,
      params: params("id"),
      success: CourseDetail,
    }),
  )
  .prefix("/api");

export const coursesAdminGroup = HttpApiGroup.make("coursesAdmin")
  .add(
    HttpApiEndpoint.get("courses", "/courses", {
      error: adminErrors,
      success: S.Array(Course),
    }),
  )
  .add(
    HttpApiEndpoint.get("courseStudents", "/courses/:id/students", {
      error: adminErrors,
      params: params("id"),
      success: S.Array(User),
    }),
  )
  .add(
    HttpApiEndpoint.post("createCourse", "/courses", {
      error: adminErrors,
      payload: CreateCoursePayload,
      success: Course,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateCourse", "/courses/:id", {
      error: adminErrors,
      params: params("id"),
      payload: UpdateCoursePayload,
      success: Course,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteCourse", "/courses/:id", {
      error: adminErrors,
      params: params("id"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createModule", "/courses/:id/modules", {
      error: adminErrors,
      params: params("id"),
      payload: CreateModulePayload,
      success: Module,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateModule", "/modules/:id", {
      error: adminErrors,
      params: params("id"),
      payload: UpdateModulePayload,
      success: Module,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteModule", "/modules/:id", {
      error: adminErrors,
      params: params("id"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("enrollStudent", "/students/:id/enroll", {
      error: adminErrors,
      params: params("id"),
      payload: EnrollStudentPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("unenrollStudent", "/students/:id/enroll/:courseId", {
      error: adminErrors,
      params: params("id", "courseId"),
      success: SuccessResponse,
    }),
  )
  .prefix("/api/admin");
