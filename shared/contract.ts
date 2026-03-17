import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApi,
  HttpApiSchema,
} from "@effect/platform";
import { Schema as S } from "effect";
import { SessionMiddleware, AuthMiddleware, AdminMiddleware } from "./middleware.js";
export {
  UserResponse,
  CourseResponse,
  ModuleResponse,
  MaterialResponse,
  CourseDetailResponse,
  StudentDetailResponse,
  SubmissionResponse,
  PracticeLogResponse,
  AssignmentNoteResponse,
  MessageResponse,
} from "./schemas.js";
import {
  UserResponse,
  CourseResponse,
  ModuleResponse,
  MaterialResponse,
  CourseDetailResponse,
  StudentDetailResponse,
  SubmissionResponse,
  PracticeLogResponse,
  AssignmentNoteResponse,
  MessageResponse,
} from "./schemas.js";

// === Response schemas (additional, contract-only) ===

const SuccessResponse = S.Struct({ success: S.Literal(true) });

const PaginationParams = S.Struct({
  offset: S.optional(S.NumberFromString),
  limit: S.optional(S.NumberFromString),
});

// === Error schemas ===

export class NotFound extends S.TaggedError<NotFound>()("NotFound", {
  error: S.String,
}) {}
export class BadRequest extends S.TaggedError<BadRequest>()("BadRequest", {
  error: S.String,
}) {}
export class Conflict extends S.TaggedError<Conflict>()("Conflict", {
  error: S.String,
}) {}
export class Locked extends S.TaggedError<Locked>()("Locked", {
  error: S.String,
}) {}

// === Public group ===

const PublicGroup = HttpApiGroup.make("public")
  .add(HttpApiEndpoint.get("health", "/api/health").addSuccess(SuccessResponse))
  .add(
    HttpApiEndpoint.post("contact", "/api/contact")
      .setPayload(
        S.Struct({
          name: S.String,
          email: S.String,
          phone: S.optional(S.String),
          instrument: S.String,
          format: S.String,
          message: S.optional(S.String),
          website: S.optional(S.String), // honeypot
        }),
      )
      .addSuccess(SuccessResponse)
      .addError(BadRequest, { status: 400 }),
  )
  // OAuth start (redirect URLs)
  .add(
    HttpApiEndpoint.get("googleOAuthStart", "/api/oauth/google")
      .addSuccess(S.Struct({ url: S.String })),
  )
  .add(
    HttpApiEndpoint.get("googleOAuthCallback", "/api/oauth/google/callback")
      .setUrlParams(S.Struct({ code: S.String, state: S.optional(S.String) }))
      .addSuccess(UserResponse)
      .addError(BadRequest, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.get("appleOAuthStart", "/api/oauth/apple")
      .addSuccess(S.Struct({ url: S.String })),
  )
  .add(
    HttpApiEndpoint.post("appleOAuthCallback", "/api/oauth/apple/callback")
      .setPayload(S.Struct({
        code: S.String,
        id_token: S.optional(S.String),
        state: S.optional(S.String),
      }))
      .addSuccess(UserResponse)
      .addError(BadRequest, { status: 400 }),
  );

// === Auth group ===

const AuthGroup = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("login", "/api/login")
      .setPayload(S.Struct({ id: S.String, password: S.String }))
      .addSuccess(UserResponse)
      .addError(BadRequest, { status: 400 })
      .addError(Locked, { status: 423 }),
  )
  // Magic link
  .add(
    HttpApiEndpoint.post("requestMagicLink", "/api/magic-link")
      .setPayload(S.Struct({ email: S.String }))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("verifyMagicLink", "/api/magic-link/verify")
      .setPayload(S.Struct({ token: S.String }))
      .addSuccess(UserResponse)
      .addError(BadRequest, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.post("logout", "/api/logout").addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("setPassword", "/api/set-password")
      .setPayload(S.Struct({ token: S.String, password: S.String }))
      .addSuccess(SuccessResponse)
      .addError(BadRequest, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.post("forgotPassword", "/api/forgot-password")
      .setPayload(S.Struct({ email: S.String }))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("resetPassword", "/api/reset-password")
      .setPayload(S.Struct({ token: S.String, password: S.String }))
      .addSuccess(SuccessResponse)
      .addError(BadRequest, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.get("me", "/api/me").addSuccess(
      S.Struct({ user: S.NullOr(UserResponse) }),
    ),
  )
  .middleware(SessionMiddleware);

// === Authenticated group (student + admin — requires login) ===

const AuthenticatedGroup = HttpApiGroup.make("authenticated")
  .add(
    HttpApiEndpoint.get("courses", "/api/courses").addSuccess(
      S.Array(CourseResponse),
    ),
  )
  .add(
    HttpApiEndpoint.get("courseDetail", "/api/courses/:id")
      .setPath(S.Struct({ id: HttpApiSchema.param("id", S.String) }))
      .addSuccess(CourseDetailResponse)
      .addError(NotFound, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.get("library", "/api/library")
      .setUrlParams(PaginationParams)
      .addSuccess(S.Array(MaterialResponse)),
  )
  .add(
    HttpApiEndpoint.get("assignments", "/api/assignments").addSuccess(
      S.Array(MaterialResponse),
    ),
  )
  // Practice logs
  .add(
    HttpApiEndpoint.get("practiceLogs", "/api/practice-logs")
      .setUrlParams(S.Struct({ material_id: S.optional(S.String) }))
      .addSuccess(S.Array(PracticeLogResponse)),
  )
  .add(
    HttpApiEndpoint.post("logPractice", "/api/practice-logs")
      .setPayload(
        S.Struct({
          material_id: S.String,
          status: S.Literal("practiced", "completed"),
          notes: S.optional(S.String),
        }),
      )
      .addSuccess(PracticeLogResponse),
  )
  // Assignment notes
  .add(
    HttpApiEndpoint.get("assignmentNote", "/api/assignments/:materialId/notes")
      .setPath(
        S.Struct({ materialId: HttpApiSchema.param("materialId", S.String) }),
      )
      .addSuccess(S.NullOr(AssignmentNoteResponse)),
  )
  .add(
    HttpApiEndpoint.put("upsertAssignmentNote", "/api/assignments/:materialId/notes")
      .setPath(
        S.Struct({ materialId: HttpApiSchema.param("materialId", S.String) }),
      )
      .setPayload(S.Struct({ body: S.String }))
      .addSuccess(AssignmentNoteResponse),
  )
  // Messaging
  .add(
    HttpApiEndpoint.get("messages", "/api/messages")
      .setUrlParams(
        S.Struct({
          with: S.optional(S.String),
          offset: S.optional(S.NumberFromString),
          limit: S.optional(S.NumberFromString),
        }),
      )
      .addSuccess(S.Array(MessageResponse)),
  )
  .add(
    HttpApiEndpoint.post("sendMessage", "/api/messages")
      .setPayload(S.Struct({ recipient_id: S.String, body: S.String }))
      .addSuccess(MessageResponse),
  )
  .add(
    HttpApiEndpoint.patch("markMessageRead", "/api/messages/:id")
      .setPath(S.Struct({ id: HttpApiSchema.param("id", S.String) }))
      .setPayload(S.Struct({ is_read: S.Literal(true) }))
      .addSuccess(SuccessResponse),
  )
  .middleware(AuthMiddleware);

// === Admin group ===

const AdminGroup = HttpApiGroup.make("admin")
  .add(
    HttpApiEndpoint.get("submissions", "/api/admin/submissions")
      .setUrlParams(PaginationParams)
      .addSuccess(S.Array(SubmissionResponse)),
  )
  .add(
    HttpApiEndpoint.patch("patchSubmission", "/api/admin/submissions/:id")
      .setPath(S.Struct({ id: HttpApiSchema.param("id", S.String) }))
      .setPayload(S.Struct({ is_read: S.Boolean }))
      .addSuccess(SuccessResponse)
      .addError(NotFound, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.get("students", "/api/admin/students").addSuccess(
      S.Array(UserResponse),
    ),
  )
  .add(
    HttpApiEndpoint.post("createStudent", "/api/admin/students")
      .setPayload(
        S.Struct({ username: S.String, email: S.String, name: S.String }),
      )
      .addSuccess(UserResponse)
      .addError(Conflict, { status: 409 }),
  )
  .add(
    HttpApiEndpoint.get("studentDetail", "/api/admin/students/:id")
      .setPath(S.Struct({ id: HttpApiSchema.param("id", S.String) }))
      .addSuccess(StudentDetailResponse)
      .addError(NotFound, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.get("adminCourses", "/api/admin/courses").addSuccess(
      S.Array(CourseResponse),
    ),
  )
  .add(
    HttpApiEndpoint.get("courseStudents", "/api/admin/courses/:id/students")
      .setPath(S.Struct({ id: HttpApiSchema.param("id", S.String) }))
      .addSuccess(S.Array(UserResponse)),
  )
  .add(
    HttpApiEndpoint.post("createCourse", "/api/admin/courses")
      .setPayload(
        S.Struct({
          title: S.String,
          description: S.optional(S.String),
          instrument: S.String,
        }),
      )
      .addSuccess(CourseResponse),
  )
  .add(
    HttpApiEndpoint.patch("updateCourse", "/api/admin/courses/:id")
      .setPath(S.Struct({ id: HttpApiSchema.param("id", S.String) }))
      .setPayload(
        S.Struct({
          title: S.optional(S.String),
          description: S.optional(S.String),
          instrument: S.optional(S.String),
        }),
      )
      .addSuccess(CourseResponse)
      .addError(NotFound, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.del("deleteCourse", "/api/admin/courses/:id")
      .setPath(S.Struct({ id: HttpApiSchema.param("id", S.String) }))
      .addSuccess(SuccessResponse)
      .addError(NotFound, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.post(
      "createModule",
      "/api/admin/courses/:courseId/modules",
    )
      .setPath(
        S.Struct({ courseId: HttpApiSchema.param("courseId", S.String) }),
      )
      .setPayload(
        S.Struct({
          title: S.String,
          description: S.optional(S.String),
          sort_order: S.optional(S.Number),
        }),
      )
      .addSuccess(ModuleResponse),
  )
  .add(
    HttpApiEndpoint.patch("updateModule", "/api/admin/modules/:id")
      .setPath(S.Struct({ id: HttpApiSchema.param("id", S.String) }))
      .setPayload(
        S.Struct({
          title: S.optional(S.String),
          description: S.optional(S.String),
          sort_order: S.optional(S.Number),
        }),
      )
      .addSuccess(ModuleResponse)
      .addError(NotFound, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.del("deleteModule", "/api/admin/modules/:id")
      .setPath(S.Struct({ id: HttpApiSchema.param("id", S.String) }))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("attachMaterial", "/api/admin/modules/:id/materials")
      .setPath(S.Struct({ id: HttpApiSchema.param("id", S.String) }))
      .setPayload(
        S.Struct({
          material_id: S.String,
          sort_order: S.optional(S.Number),
        }),
      )
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.del(
      "detachMaterial",
      "/api/admin/modules/:moduleId/materials/:materialId",
    )
      .setPath(
        S.Struct({
          moduleId: HttpApiSchema.param("moduleId", S.String),
          materialId: HttpApiSchema.param("materialId", S.String),
        }),
      )
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("enrollStudent", "/api/admin/students/:id/enroll")
      .setPath(S.Struct({ id: HttpApiSchema.param("id", S.String) }))
      .setPayload(S.Struct({ course_id: S.String }))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.del(
      "unenrollStudent",
      "/api/admin/students/:id/enroll/:courseId",
    )
      .setPath(
        S.Struct({
          id: HttpApiSchema.param("id", S.String),
          courseId: HttpApiSchema.param("courseId", S.String),
        }),
      )
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("assignMaterial", "/api/admin/students/:id/assign")
      .setPath(S.Struct({ id: HttpApiSchema.param("id", S.String) }))
      .setPayload(S.Struct({ material_id: S.String }))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.del(
      "unassignMaterial",
      "/api/admin/students/:id/assign/:materialId",
    )
      .setPath(
        S.Struct({
          id: HttpApiSchema.param("id", S.String),
          materialId: HttpApiSchema.param("materialId", S.String),
        }),
      )
      .addSuccess(SuccessResponse),
  )
  .middleware(AdminMiddleware);

// === Compose API ===

export const DfgPortalApi = HttpApi.make("DfgPortalApi")
  .add(PublicGroup)
  .add(AuthGroup)
  .add(AuthenticatedGroup)
  .add(AdminGroup);
