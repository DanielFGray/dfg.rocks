import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as Multipart from "effect/http/Multipart";
import { Schema as S } from "effect";
import {
  Adjustment,
  BooleanFromString,
  AssignedMaterial,
  AssignmentNote,
  AssignmentProgress,
  AssignmentReview,
  Bill,
  BillingModel,
  BillDetailResponse,
  FamilyBill,
  FamilyBillDetailResponse,
  FamilyPayment,
  FamilyPaymentDetail,
  CancellationPolicySettings,
  Course,
  CourseDetail,
  CreateChildPayload,
  CreateChildResponse,
  CreditApplication,
  Family,
  FamilyBillingDetail,
  FamilyBillingOverview,
  FamilyBillingSummary,
  FamilyCredit,
  AdminFamilyCredit,
  FamilyDiscount,
  FamilyInviteRole,
  FamilyInvitation,
  FamilyTaxExemption,
  GcalStatus,
  Lesson,
  LessonCancellationPolicy,
  LessonNote,
  LessonStatus,
  LocationType,
  JsonValue,
  Material,
  Message,
  MonthlyPayment,
  MonthlyPaymentStatus,
  Module,
  Payment,
  PaymentMethod,
  PracticeLog,
  Refund,
  Submission,
  StudentDetail,
  StudentRate,
  RecurringSchedule,
  TaxRate,
  Testimonial,
  TimeSlot,
  User,
  UserEmail,
  WorkingHours,
} from "./schemas.js";
import {
  BadGatewayErrorSchema,
  BadRequestErrorSchema,
  ConflictErrorSchema,
  ForbiddenErrorSchema,
  InternalServerErrorSchema,
  LockedErrorSchema,
  NotFoundErrorSchema,
  PayloadTooLargeErrorSchema,
  ServiceUnavailableErrorSchema,
  TooManyRequestsErrorSchema,
  UnauthorizedErrorSchema,
} from "./httpApiErrors.js";

export function params<const Name extends string>(...names: readonly Name[]) {
  return S.Struct(
    Object.fromEntries(names.map((name) => [name, S.String])) as Record<Name, typeof S.String>,
  );
}

export const SuccessResponse = S.Struct({ success: S.Literal(true) });

export const ReminderIntervalResponse = S.Struct({
  success: S.Literal(true),
  interval_days: S.Number,
});

export const TestimonialReminderIntervalResponse = S.Struct({
  interval_days: S.Number,
});

export const QrInviteResponse = S.Struct({
  invitationId: S.String,
  code: S.String,
  url: S.String,
  expiresAt: S.String,
});

const PaginationQuery = S.Struct({
  limit: S.optional(S.NumberFromString),
  offset: S.optional(S.NumberFromString),
});

const LoginPayload = S.Struct({
  id: S.String,
  password: S.String,
});

const MagicLinkPayload = S.Struct({ email: S.String });

const VerifyMagicLinkPayload = S.Struct({ token: S.String });

const ResetPasswordPayload = S.Struct({
  token: S.String,
  password: S.String,
});

export const MeResponse = S.Struct({
  user: S.NullOr(User),
  isParent: S.Boolean,
  familyStudents: S.Array(User),
  activeStudentId: S.NullishOr(S.String),
  activeStudent: S.NullishOr(
    S.Struct({
      id: S.String,
      username: S.String,
      name: S.String,
    }),
  ),
});

export type MeResponse = S.Schema.Type<typeof MeResponse>;

const ContactPayload = S.Struct({
  name: S.String,
  email: S.String,
  phone: S.optional(S.String),
  instrument: S.String,
  format: S.String,
  message: S.optional(S.String),
  website: S.optional(S.String),
});

const TokenPayload = S.Struct({ token: S.String });

const InvitationResponse = S.Struct({
  id: S.String,
  slug: S.String,
  name: S.String,
  description: S.NullishOr(S.String),
  created_at: S.String,
  email: S.String,
  invited_role: S.optional(FamilyInviteRole),
});

const InvitationUrlParams = S.Struct({
  code: S.optional(S.String),
});

const AcceptInvitationPayload = S.Struct({
  code: S.optional(S.String),
  username: S.String,
  password: S.String,
  name: S.String,
  email: S.optional(S.String),
});

const AppleUserPayload = S.Struct({
  email: S.optional(S.String),
  name: S.optional(
    S.Struct({
      firstName: S.optional(S.String),
      lastName: S.optional(S.String),
    }),
  ),
});

const AppleCallbackPayload = S.Struct({
  error: S.optional(S.String),
  code: S.optional(S.String),
  state: S.optional(S.String),
  user: S.optional(S.fromJsonString(AppleUserPayload)),
}).pipe(HttpApiSchema.asMultipart());

const AssignStudentMaterialPayload = S.Struct({
  material_id: S.String,
  assigned_track_index: S.optional(S.NullishOr(S.Number)),
});

const PracticeLogQuery = S.Struct({
  material_id: S.optional(S.String),
});

const RecordAssignmentPlaybackPayload = S.Struct({
  seconds: S.Number,
});

const CreateAssignmentReviewPayload = S.Struct({
  stars: S.Number,
});

const AssignmentNotePayload = S.Struct({
  body: S.String,
});

const MessageListQuery = S.Struct({
  limit: S.optional(S.NumberFromString),
  offset: S.optional(S.NumberFromString),
  with: S.optional(S.String),
});

const CreateMessagePayload = S.Struct({
  recipient_id: S.optional(S.String),
  body: S.String,
});

const MarkMessageReadPayload = S.Struct({
  is_read: S.optional(S.Boolean),
});

const MyLessonsQuery = S.Struct({
  limit: S.optional(S.NumberFromString),
  offset: S.optional(S.NumberFromString),
  status: S.optional(LessonStatus),
  from: S.optional(S.String),
  to: S.optional(S.String),
});

const ConfirmDeleteAccountPayload = S.Struct({
  token: S.String,
});

const AvailableSlotsQuery = S.Struct({
  date: S.String,
  days: S.optional(S.NumberFromString),
  duration: S.optional(S.NumberFromString),
});

const BookLessonPayload = S.Struct({
  scheduled_at: S.String,
  duration_minutes: S.Number,
  location_type: LocationType,
  student_id: S.optional(S.String),
});

const AddEmailPayload = S.Struct({
  email: S.String,
});

const TestimonialPayload = S.Struct({
  body: S.String.pipe(S.check(S.isMinLength(20)), S.check(S.isMaxLength(2000))),
});

const UpdateSubmissionPayload = S.Struct({
  is_read: S.Boolean,
});

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
  content: S.optional(JsonValue),
  sort_order: S.optional(S.Number),
});

const EnrollStudentPayload = S.Struct({
  course_id: S.String,
});

const InviteFamilyPayload = S.Struct({
  username: S.optional(S.String),
  email: S.optional(S.String),
  invited_role: FamilyInviteRole,
});

const QrInvitePayload = S.Struct({
  name: S.optional(S.String),
  slug: S.optional(S.String),
  invited_role: FamilyInviteRole,
});

const CreateLessonPayload = S.Struct({
  student_id: S.String,
  scheduled_at: S.String,
  duration_minutes: S.Number,
  location_type: LocationType,
});

const UpdateLessonPayload = S.Struct({
  scheduled_at: S.optional(S.String),
  duration_minutes: S.optional(S.Number),
  location_type: S.optional(LocationType),
});

const AdminLessonsQuery = S.Struct({
  limit: S.optional(S.NumberFromString),
  offset: S.optional(S.NumberFromString),
  student_id: S.optional(S.String),
  status: S.optional(LessonStatus),
  from: S.optional(S.String),
  to: S.optional(S.String),
});

const SaveLessonNotePayload = S.Struct({
  topics_covered: S.optional(S.String),
  homework: S.optional(S.String),
  progress_observations: S.optional(S.String),
  notes: S.optional(S.String),
  material_ids: S.optional(S.Array(S.String)),
  draft: S.optional(S.Boolean),
});

const UploadMaterialPayload = S.Struct({
  file: Multipart.SingleFileSchema,
  title: S.String,
  is_global: BooleanFromString,
}).pipe(HttpApiSchema.asMultipart());

const SaveReminderIntervalPayload = S.Struct({
  interval_days: S.Number.pipe(S.check(S.isBetween({ minimum: 1, maximum: 365 }))),
});

const SwitchActiveStudentPayload = S.Struct({
  student_id: S.String,
});

const UpdateTestimonialApprovalPayload = S.Struct({
  is_approved: S.Boolean,
});

export const CreateFamilyPayload = S.Struct({
  slug: S.String,
  name: S.String,
});

export const SaveStudentRatePayload = S.Struct({
  student_id: S.String,
  rate_cents: S.Number.pipe(S.check(S.isInt()), S.check(S.isGreaterThan(0))),
  lesson_duration_minutes: S.Literals([30, 60]),
  location_type: LocationType,
  billing_model: BillingModel,
  notes: S.optional(S.String),
});

export const CancelLessonPayload = S.Struct({
  reason: S.optional(S.String.pipe(S.check(S.isMaxLength(1000)))),
});

export const RescheduleLessonPayload = S.Struct({
  scheduled_at: S.String,
});

export const CreatePracticeLogPayload = S.Struct({
  material_id: S.String,
  rating: S.optional(S.Number.pipe(S.check(S.isBetween({ minimum: 1, maximum: 5 })))),
  duration_minutes: S.optional(S.Number),
});

export const RatePracticeLogPayload = S.Struct({
  material_id: S.String,
  rating: S.Number.pipe(S.check(S.isBetween({ minimum: 1, maximum: 5 }))),
});

export const GcalCallbackQuery = S.Struct({
  error: S.optional(S.String),
  code: S.optional(S.String),
  state: S.optional(S.String),
});

export const StudentRatesQuery = S.Struct({
  location_type: S.optional(LocationType),
});

export const SaveRecurringSchedulePayload = S.Struct({
  id: S.optional(S.String),
  student_rate_id: S.String,
  day_of_week: S.Number.pipe(S.check(S.isInt()), S.check(S.isBetween({ minimum: 1, maximum: 7 }))),
  local_start_time: S.String,
  timezone: S.String,
  starts_on: S.String,
  ends_on: S.optional(S.NullishOr(S.String)),
  active: S.optional(S.Boolean),
});

export type SaveRecurringSchedulePayload = S.Schema.Type<typeof SaveRecurringSchedulePayload>;

export const RecordMonthlyPaymentPayload = S.Struct({
  billing_month: S.String,
  amount_cents: S.Number.pipe(S.check(S.isInt()), S.check(S.isGreaterThan(0))),
  paid_at: S.String,
  notes: S.optional(S.NullishOr(S.String)),
});

export type RecordMonthlyPaymentPayload = S.Schema.Type<typeof RecordMonthlyPaymentPayload>;

export const MonthlyPaymentStatusQuery = S.Struct({ month: S.String });

// Testing schemas
export const TestingLoginQuery = S.Struct({
  username: S.optional(S.String),
  password: S.optional(S.String),
  role: S.optional(
    S.Union([S.Literal("admin"), S.Literal("teacher"), S.Literal("student"), S.Literal("parent")]),
  ),
  name: S.optional(S.String),
  email: S.optional(S.String),
});

export const TestingTestimonialReminderQuery = S.Struct({
  username: S.String,
  prompt_enabled: S.optional(BooleanFromString),
  next_prompt_at: S.optional(S.String),
});

export const SeedCoursePayload = S.Struct({
  title: S.String,
  instrument: S.String,
  description: S.optional(S.String),
  modules: S.optional(
    S.Array(
      S.Struct({
        title: S.String,
        sort_order: S.optional(S.Number),
      }),
    ),
  ),
});

export const SeedMaterialPayload = S.Struct({
  title: S.String,
  original_filename: S.optional(S.String),
  mime_type: S.optional(S.String),
  file_size: S.optional(S.Number),
  is_global: S.optional(S.Boolean),
  source_file_path: S.optional(S.String),
});

export const TestingAssignMaterialQuery = S.Struct({
  username: S.String,
  material_title: S.String,
  assigned_track_index: S.optional(S.String),
});

export const TestingEnrollQuery = S.Struct({
  username: S.String,
  course_title: S.String,
});

export const TestingSeedFamilyQuery = S.Struct({
  slug: S.optional(S.String),
  name: S.optional(S.String),
  owner_username: S.optional(S.String),
});

export const TestingSeedFamilyMembershipQuery = S.Struct({
  username: S.String,
  family_slug: S.String,
  is_owner: S.optional(BooleanFromString),
  is_billing_contact: S.optional(BooleanFromString),
});

export const TestingSeedInvitationQuery = S.Struct({
  email: S.String,
  family_slug: S.optional(S.String),
  invited_role: S.optional(FamilyInviteRole),
  expires_at: S.optional(S.String),
});

export const TestingSeedDeleteAccountQuery = S.Struct({
  username: S.String,
});

export const TestingSeedLessonQuery = S.Struct({
  username: S.String,
  scheduled_at: S.optional(S.String),
  duration_minutes: S.optional(S.NumberFromString),
  location_type: S.optional(LocationType),
  status: S.optional(LessonStatus),
});

const publicErrors = [
  BadRequestErrorSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  ConflictErrorSchema,
  TooManyRequestsErrorSchema,
  InternalServerErrorSchema,
  BadGatewayErrorSchema,
  ServiceUnavailableErrorSchema,
] as const;

export const publicGroup = HttpApiGroup.make("public")
  .add(HttpApiEndpoint.get("health", "/health", { error: publicErrors, success: SuccessResponse }))
  .add(
    HttpApiEndpoint.post("contact", "/contact", {
      error: publicErrors,
      payload: ContactPayload,
      success: SuccessResponse,
    }),
  )
  .add(HttpApiEndpoint.get("oauthGoogle", "/oauth/google", { error: publicErrors }))
  .add(
    HttpApiEndpoint.get("oauthGoogleCallback", "/oauth/google/callback", { error: publicErrors }),
  )
  .add(HttpApiEndpoint.get("oauthApple", "/oauth/apple", { error: publicErrors }))
  .add(
    HttpApiEndpoint.post("oauthAppleCallback", "/oauth/apple/callback", {
      error: publicErrors,
      payload: AppleCallbackPayload,
    }),
  )
  .add(
    HttpApiEndpoint.post("verifyEmail", "/verify-email", {
      error: publicErrors,
      payload: TokenPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("invitation", "/invitation/:id", {
      error: publicErrors,
      params: params("id"),
      query: InvitationUrlParams,
      success: InvitationResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("acceptInvitation", "/invitation/:id/accept", {
      error: publicErrors,
      params: params("id"),
      payload: AcceptInvitationPayload,
      success: User,
    }),
  )
  .prefix("/api");

const authErrors = [
  BadRequestErrorSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ConflictErrorSchema,
  LockedErrorSchema,
  TooManyRequestsErrorSchema,
  InternalServerErrorSchema,
] as const;

export const authGroup = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("login", "/login", {
      error: authErrors,
      payload: LoginPayload,
      success: User,
    }),
  )
  .add(
    HttpApiEndpoint.post("magicLink", "/magic-link", {
      error: authErrors,
      payload: MagicLinkPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("verifyMagicLink", "/magic-link/verify", {
      error: authErrors,
      payload: VerifyMagicLinkPayload,
      success: User,
    }),
  )
  .add(HttpApiEndpoint.post("logout", "/logout", { error: authErrors, success: SuccessResponse }))
  .add(
    HttpApiEndpoint.post("forgotPassword", "/forgot-password", {
      error: authErrors,
      payload: MagicLinkPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("resetPassword", "/reset-password", {
      error: authErrors,
      payload: ResetPasswordPayload,
      success: SuccessResponse,
    }),
  )
  .add(HttpApiEndpoint.get("me", "/me", { error: authErrors, success: MeResponse }))
  .add(
    HttpApiEndpoint.post("resendVerification", "/resend-verification", {
      error: authErrors,
      success: SuccessResponse,
    }),
  )
  .prefix("/api");

export const FamilyMember = S.Struct({
  id: S.String,
  username: S.String,
  name: S.NullishOr(S.String),
  role: S.String,
  is_verified: S.Boolean,
  is_owner: S.Boolean,
  is_billing_contact: S.Boolean,
});

export const FamilyInfo = S.Struct({
  id: S.String,
  slug: S.String,
  name: S.String,
  description: S.NullishOr(S.String),
  members: S.Array(FamilyMember),
  pendingInvitations: S.Array(
    S.Struct({
      id: S.String,
      email: S.NullishOr(S.String),
      invited_role: S.String,
      code: S.NullishOr(S.String),
      expires_at: S.NullishOr(S.String),
    }),
  ),
});

const RemoveMemberPayload = S.Struct({
  user_id: S.String,
});

const InviteFamilyMemberPayload = S.Struct({
  email: S.String,
});

const SetChildEmailPayload = S.Struct({
  email: S.String,
});

const SetChildPasswordPayload = S.Struct({
  token: S.String,
  password: S.String,
});

const ChildPasswordResetTokenResponse = S.Struct({
  token: S.String,
});

export const authenticatedClientErrors = [
  BadRequestErrorSchema,
  UnauthorizedErrorSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  ConflictErrorSchema,
  InternalServerErrorSchema,
  BadGatewayErrorSchema,
  ServiceUnavailableErrorSchema,
] as const;

export const authenticatedClientGroup = HttpApiGroup.make("authenticated")
  .add(
    HttpApiEndpoint.get("courses", "/courses", {
      error: authenticatedClientErrors,
      success: S.Array(Course),
    }),
  )
  .add(
    HttpApiEndpoint.get("courseById", "/courses/:id", {
      error: authenticatedClientErrors,
      params: params("id"),
      success: CourseDetail,
    }),
  )
  .add(
    HttpApiEndpoint.get("library", "/library", {
      error: authenticatedClientErrors,
      query: PaginationQuery,
      success: S.Array(Material),
    }),
  )
  .add(
    HttpApiEndpoint.get("assignments", "/assignments", {
      error: authenticatedClientErrors,
      success: S.Array(AssignedMaterial),
    }),
  )
  .add(
    HttpApiEndpoint.post("assignStudentMaterial", "/assignments/students/:studentId/assign", {
      error: authenticatedClientErrors,
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
        error: authenticatedClientErrors,
        params: params("studentId", "materialId"),
        success: SuccessResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("practiceLogs", "/practice-logs", {
      error: authenticatedClientErrors,
      query: PracticeLogQuery,
      success: S.Array(PracticeLog),
    }),
  )
  .add(
    HttpApiEndpoint.post("createPracticeLog", "/practice-logs", {
      error: authenticatedClientErrors,
      payload: CreatePracticeLogPayload,
      success: PracticeLog,
    }),
  )
  .add(
    HttpApiEndpoint.post("ratePracticeLog", "/practice-logs/rate", {
      error: authenticatedClientErrors,
      payload: RatePracticeLogPayload,
      success: PracticeLog,
    }),
  )
  .add(
    HttpApiEndpoint.post("recordAssignmentPlayback", "/assignments/:materialId/playback", {
      error: authenticatedClientErrors,
      params: params("materialId"),
      payload: RecordAssignmentPlaybackPayload,
      success: AssignmentProgress,
    }),
  )
  .add(
    HttpApiEndpoint.post("createAssignmentReview", "/assignments/:materialId/reviews", {
      error: authenticatedClientErrors,
      params: params("materialId"),
      payload: CreateAssignmentReviewPayload,
      success: AssignmentReview,
    }),
  )
  .add(
    HttpApiEndpoint.get("assignmentNotes", "/assignments/:materialId/notes", {
      error: authenticatedClientErrors,
      params: params("materialId"),
      success: S.NullOr(AssignmentNote),
    }),
  )
  .add(
    HttpApiEndpoint.put("upsertAssignmentNotes", "/assignments/:materialId/notes", {
      error: authenticatedClientErrors,
      params: params("materialId"),
      payload: AssignmentNotePayload,
      success: AssignmentNote,
    }),
  )
  .add(
    HttpApiEndpoint.get("messages", "/messages", {
      error: authenticatedClientErrors,
      query: MessageListQuery,
      success: S.Array(Message),
    }),
  )
  .add(
    HttpApiEndpoint.post("createMessage", "/messages", {
      error: authenticatedClientErrors,
      payload: CreateMessagePayload,
      success: Message,
    }),
  )
  .add(
    HttpApiEndpoint.patch("markMessageRead", "/messages/:id", {
      error: authenticatedClientErrors,
      params: params("id"),
      payload: MarkMessageReadPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("myLessons", "/my-lessons", {
      error: authenticatedClientErrors,
      query: MyLessonsQuery,
      success: S.Array(Lesson),
    }),
  )
  .add(
    HttpApiEndpoint.get("myLessonCancellationPolicy", "/my-lessons/:id/cancellation-policy", {
      error: authenticatedClientErrors,
      params: params("id"),
      success: LessonCancellationPolicy,
    }),
  )
  .add(
    HttpApiEndpoint.post("cancelMyLesson", "/my-lessons/:id/cancel", {
      error: authenticatedClientErrors,
      params: params("id"),
      payload: CancelLessonPayload,
      success: Lesson,
    }),
  )
  .add(
    HttpApiEndpoint.post("rescheduleMyLesson", "/my-lessons/:id/reschedule", {
      error: authenticatedClientErrors,
      params: params("id"),
      payload: RescheduleLessonPayload,
      success: Lesson,
    }),
  )
  .add(
    HttpApiEndpoint.post("requestDeleteAccount", "/request-delete-account", {
      error: authenticatedClientErrors,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("confirmDeleteAccount", "/confirm-delete-account", {
      error: authenticatedClientErrors,
      payload: ConfirmDeleteAccountPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("myLessonNotesList", "/my-lesson-notes", {
      error: authenticatedClientErrors,
      query: PaginationQuery,
      success: S.Array(LessonNote),
    }),
  )
  .add(
    HttpApiEndpoint.get("myEmails", "/me/emails", {
      error: authenticatedClientErrors,
      success: S.Array(UserEmail),
    }),
  )
  .add(
    HttpApiEndpoint.post("addMyEmail", "/me/emails", {
      error: authenticatedClientErrors,
      payload: AddEmailPayload,
      success: UserEmail,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteMyEmail", "/me/emails/:id", {
      error: authenticatedClientErrors,
      params: params("id"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("makePrimaryEmail", "/me/emails/:id/make-primary", {
      error: authenticatedClientErrors,
      params: params("id"),
      success: UserEmail,
    }),
  )
  .add(
    HttpApiEndpoint.post("resendEmailVerification", "/me/emails/:id/resend-verification", {
      error: authenticatedClientErrors,
      params: params("id"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.put("upsertTestimonial", "/testimonials", {
      error: authenticatedClientErrors,
      payload: TestimonialPayload,
      success: Testimonial,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteTestimonial", "/testimonials", {
      error: authenticatedClientErrors,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("availableSlots", "/available-slots", {
      error: authenticatedClientErrors,
      query: AvailableSlotsQuery,
      success: S.Array(TimeSlot),
    }),
  )
  .add(
    HttpApiEndpoint.post("bookLesson", "/my-lessons/book", {
      error: authenticatedClientErrors,
      payload: BookLessonPayload,
      success: Lesson,
    }),
  )
  .add(
    HttpApiEndpoint.post("switchActiveStudent", "/switch-active-student", {
      error: authenticatedClientErrors,
      payload: SwitchActiveStudentPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createChild", "/create-child", {
      error: authenticatedClientErrors,
      payload: CreateChildPayload,
      success: CreateChildResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("family", "/family", {
      error: authenticatedClientErrors,
      success: FamilyInfo,
    }),
  )
  .add(
    HttpApiEndpoint.post("removeFamilyMember", "/family/remove-member", {
      error: authenticatedClientErrors,
      payload: RemoveMemberPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("inviteFamilyMember", "/family/invite", {
      error: authenticatedClientErrors,
      payload: InviteFamilyMemberPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("setChildEmail", "/family/child/:childId/email", {
      error: authenticatedClientErrors,
      params: params("childId"),
      payload: SetChildEmailPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("requestChildPasswordSet", "/family/child/:childId/request-password-set", {
      error: authenticatedClientErrors,
      params: params("childId"),
      success: ChildPasswordResetTokenResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("setChildPassword", "/family/child/:childId/set-password", {
      error: authenticatedClientErrors,
      params: params("childId"),
      payload: SetChildPasswordPayload,
      success: SuccessResponse,
    }),
  )
  .prefix("/api");

export const SaveCancellationPolicySettingsPayload = S.Struct({
  cancellation_window_hours: S.Number.pipe(S.check(S.isBetween({ minimum: 0, maximum: 720 }))),
  late_cancel_charge_percent: S.Number.pipe(S.check(S.isBetween({ minimum: 0, maximum: 100 }))),
});

// Billing payloads

const CreateBillLineItemPayload = S.Struct({
  student_id: S.String,
  line_type: S.Union([
    S.Literal("lesson"),
    S.Literal("single_booking"),
    S.Literal("fee"),
    S.Literal("adjustment"),
    S.Literal("credit"),
  ]),
  description: S.String,
  quantity: S.Number,
  unit_price_cents: S.Number,
  amount_cents: S.Number,
});

const CreateBillPayload = S.Struct({
  family_id: S.String,
  billing_period_start: S.String,
  billing_period_end: S.String,
  due_date: S.optional(S.String),
  line_items: S.Array(CreateBillLineItemPayload),
  notes: S.optional(S.String),
});

const VoidBillPayload = S.Struct({
  reason: S.String.pipe(S.check(S.isMinLength(1))),
});

const AdjustBillPayload = S.Struct({
  amount_cents: S.Number,
  reason: S.String.pipe(S.check(S.isMinLength(1))),
});

const PaymentAllocationPayload = S.Struct({
  bill_id: S.String,
  amount_cents: S.Number,
});

const RecordPaymentPayload = S.Struct({
  family_id: S.String,
  amount_cents: S.Number,
  method: PaymentMethod,
  reference: S.optional(S.String),
  received_at: S.optional(S.String),
  notes: S.optional(S.String),
  allocations: S.Array(PaymentAllocationPayload),
});

const CreateCreditPayload = S.Struct({
  family_id: S.String,
  student_id: S.optional(S.String),
  amount_cents: S.Number,
  reason: S.String.pipe(S.check(S.isMinLength(1))),
  expires_at: S.optional(S.String),
});

const ApplyCreditPayload = S.Struct({
  credit_id: S.String,
  bill_id: S.String,
  amount_cents: S.Number,
});

const RefundPaymentPayload = S.Struct({
  amount_cents: S.Number,
  reason: S.String.pipe(S.check(S.isMinLength(1))),
});

const CreateDiscountPayload = S.Struct({
  family_id: S.String,
  label: S.String,
  discount_type: S.Literals(["percentage", "fixed"]),
  discount_value: S.Number,
  applies_to: S.Union([S.Literal("all"), S.Literal("tuition"), S.Literal("fees")]),
  effective_from: S.String,
  effective_until: S.optional(S.String),
});

const UpdateDiscountPayload = S.Struct({
  label: S.optional(S.String),
  discount_type: S.optional(S.Literals(["percentage", "fixed"])),
  discount_value: S.optional(S.Number),
  applies_to: S.optional(S.Union([S.Literal("all"), S.Literal("tuition"), S.Literal("fees")])),
  effective_from: S.optional(S.String),
  effective_until: S.optional(S.String),
  is_active: S.optional(S.Boolean),
});

const CreateTaxRatePayload = S.Struct({
  label: S.String,
  jurisdiction: S.String,
  rate_percent: S.Number.pipe(S.check(S.isBetween({ minimum: 0, maximum: 30 }))),
  applies_to: S.Union([S.Literal("all"), S.Literal("tuition"), S.Literal("fees")]),
  effective_from: S.String,
  effective_until: S.optional(S.String),
});

const CreateTaxExemptionPayload = S.Struct({
  family_id: S.String,
  tax_rate_id: S.String,
  exemption_reason: S.String,
  effective_from: S.String,
  effective_until: S.optional(S.String),
});

export const adminClientErrors = [
  BadRequestErrorSchema,
  UnauthorizedErrorSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  ConflictErrorSchema,
  PayloadTooLargeErrorSchema,
  InternalServerErrorSchema,
  BadGatewayErrorSchema,
  ServiceUnavailableErrorSchema,
] as const;

export const adminClientGroup = HttpApiGroup.make("admin")
  .add(
    HttpApiEndpoint.get("submissions", "/submissions", {
      error: adminClientErrors,
      query: PaginationQuery,
      success: S.Array(Submission),
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateSubmission", "/submissions/:id", {
      error: adminClientErrors,
      params: params("id"),
      payload: UpdateSubmissionPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("students", "/students", {
      error: adminClientErrors,
      success: S.Array(User),
    }),
  )
  .add(
    HttpApiEndpoint.get("student", "/students/:id", {
      error: adminClientErrors,
      params: params("id"),
      success: StudentDetail,
    }),
  )
  .add(
    HttpApiEndpoint.get("courses", "/courses", {
      error: adminClientErrors,
      success: S.Array(Course),
    }),
  )
  .add(
    HttpApiEndpoint.get("courseStudents", "/courses/:id/students", {
      error: adminClientErrors,
      params: params("id"),
      success: S.Array(User),
    }),
  )
  .add(
    HttpApiEndpoint.post("createCourse", "/courses", {
      error: adminClientErrors,
      payload: CreateCoursePayload,
      success: Course,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateCourse", "/courses/:id", {
      error: adminClientErrors,
      params: params("id"),
      payload: UpdateCoursePayload,
      success: Course,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteCourse", "/courses/:id", {
      error: adminClientErrors,
      params: params("id"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createModule", "/courses/:id/modules", {
      error: adminClientErrors,
      params: params("id"),
      payload: CreateModulePayload,
      success: Module,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateModule", "/modules/:id", {
      error: adminClientErrors,
      params: params("id"),
      payload: UpdateModulePayload,
      success: Module,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteModule", "/modules/:id", {
      error: adminClientErrors,
      params: params("id"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("enrollStudent", "/students/:id/enroll", {
      error: adminClientErrors,
      params: params("id"),
      payload: EnrollStudentPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("unenrollStudent", "/students/:id/enroll/:courseId", {
      error: adminClientErrors,
      params: params("id", "courseId"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("assignMaterial", "/students/:id/assign", {
      error: adminClientErrors,
      params: params("id"),
      payload: AssignStudentMaterialPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("unassignMaterial", "/students/:id/assign/:materialId", {
      error: adminClientErrors,
      params: params("id", "materialId"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteMaterial", "/materials/:id", {
      error: adminClientErrors,
      params: params("id"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("uploadMaterial", "/materials/upload", {
      error: adminClientErrors,
      payload: UploadMaterialPayload,
      success: Material,
    }),
  )
  .add(
    HttpApiEndpoint.get("families", "/families", {
      error: adminClientErrors,
      success: S.Array(Family),
    }),
  )
  .add(
    HttpApiEndpoint.post("createFamily", "/families", {
      error: adminClientErrors,
      payload: CreateFamilyPayload,
      success: Family,
    }),
  )
  .add(
    HttpApiEndpoint.post("inviteFamily", "/families/:familyId/invite", {
      error: adminClientErrors,
      params: params("familyId"),
      payload: InviteFamilyPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("qrInvite", "/families/:familyId/qr-invite", {
      error: adminClientErrors,
      params: params("familyId"),
      payload: QrInvitePayload,
      success: QrInviteResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("familyInvitations", "/families/:familyId/invitations", {
      error: adminClientErrors,
      params: params("familyId"),
      success: S.Array(FamilyInvitation),
    }),
  )
  .add(
    HttpApiEndpoint.post("saveStudentRate", "/student-rates", {
      error: adminClientErrors,
      payload: SaveStudentRatePayload,
      success: StudentRate,
    }),
  )
  .add(
    HttpApiEndpoint.get("studentRates", "/student-rates/:studentId", {
      error: adminClientErrors,
      params: params("studentId"),
      query: StudentRatesQuery,
      success: S.Array(StudentRate),
    }),
  )
  .add(
    HttpApiEndpoint.get("recurringSchedules", "/students/:studentId/recurring-schedules", {
      error: adminClientErrors,
      params: params("studentId"),
      success: S.Array(RecurringSchedule),
    }),
  )
  .add(
    HttpApiEndpoint.post("saveRecurringSchedule", "/students/:studentId/recurring-schedules", {
      error: adminClientErrors,
      params: params("studentId"),
      payload: SaveRecurringSchedulePayload,
      success: RecurringSchedule,
    }),
  )
  .add(
    HttpApiEndpoint.get("monthlyPayments", "/students/:studentId/monthly-payments", {
      error: adminClientErrors,
      params: params("studentId"),
      success: S.Array(MonthlyPayment),
    }),
  )
  .add(
    HttpApiEndpoint.get("monthlyPaymentStatus", "/monthly-payments", {
      error: adminClientErrors,
      query: MonthlyPaymentStatusQuery,
      success: S.Array(MonthlyPaymentStatus),
    }),
  )
  .add(
    HttpApiEndpoint.post("recordMonthlyPayment", "/students/:studentId/monthly-payments", {
      error: adminClientErrors,
      params: params("studentId"),
      payload: RecordMonthlyPaymentPayload,
      success: MonthlyPayment,
    }),
  )
  .add(
    HttpApiEndpoint.post("createLesson", "/lessons", {
      error: adminClientErrors,
      payload: CreateLessonPayload,
      success: Lesson,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateLesson", "/lessons/:id", {
      error: adminClientErrors,
      params: params("id"),
      payload: UpdateLessonPayload,
      success: Lesson,
    }),
  )
  .add(
    HttpApiEndpoint.get("lessons", "/lessons", {
      error: adminClientErrors,
      query: AdminLessonsQuery,
      success: S.Array(Lesson),
    }),
  )
  .add(
    HttpApiEndpoint.post("cancelLesson", "/lessons/:id/cancel", {
      error: adminClientErrors,
      params: params("id"),
      payload: CancelLessonPayload,
      success: Lesson,
    }),
  )
  .add(
    HttpApiEndpoint.post("completeLesson", "/lessons/:id/complete", {
      error: adminClientErrors,
      params: params("id"),
      success: Lesson,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteLesson", "/lessons/:id", {
      error: adminClientErrors,
      params: params("id"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveLessonNote", "/lessons/:id/notes", {
      error: adminClientErrors,
      params: params("id"),
      payload: SaveLessonNotePayload,
      success: LessonNote,
    }),
  )
  .add(
    HttpApiEndpoint.get("lessonNote", "/lessons/:id/notes", {
      error: adminClientErrors,
      params: params("id"),
      success: LessonNote,
    }),
  )
  .add(
    HttpApiEndpoint.patch("publishLessonNote", "/lessons/:id/notes/publish", {
      error: adminClientErrors,
      params: params("id"),
      success: LessonNote,
    }),
  )
  .add(
    HttpApiEndpoint.get("gcalStatus", "/gcal/status", {
      error: adminClientErrors,
      success: GcalStatus,
    }),
  )
  .add(
    HttpApiEndpoint.post("gcalDisconnect", "/gcal/disconnect", {
      error: adminClientErrors,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("workingHours", "/working-hours", {
      error: adminClientErrors,
      success: WorkingHours,
    }),
  )
  .add(
    HttpApiEndpoint.get("cancellationPolicySettings", "/cancellation-policy", {
      error: adminClientErrors,
      success: CancellationPolicySettings,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveCancellationPolicySettings", "/cancellation-policy", {
      error: adminClientErrors,
      payload: SaveCancellationPolicySettingsPayload,
      success: CancellationPolicySettings,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveWorkingHours", "/working-hours", {
      error: adminClientErrors,
      payload: WorkingHours,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("testimonialReminderInterval", "/testimonial-reminder-interval", {
      error: adminClientErrors,
      success: TestimonialReminderIntervalResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveTestimonialReminderInterval", "/testimonial-reminder-interval", {
      error: adminClientErrors,
      payload: SaveReminderIntervalPayload,
      success: ReminderIntervalResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateTestimonialApproval", "/testimonials/:id", {
      error: adminClientErrors,
      params: params("id"),
      payload: UpdateTestimonialApprovalPayload,
      success: SuccessResponse,
    }),
  )
  // Billing endpoints
  .add(
    HttpApiEndpoint.get("billingFamilies", "/billing/families", {
      error: adminClientErrors,
      success: S.Array(FamilyBillingSummary),
    }),
  )
  .add(
    HttpApiEndpoint.get("billingFamily", "/billing/families/:familyId", {
      error: adminClientErrors,
      params: params("familyId"),
      success: FamilyBillingDetail,
    }),
  )
  .add(
    HttpApiEndpoint.get("billingFamilyBills", "/billing/families/:familyId/bills", {
      error: adminClientErrors,
      params: params("familyId"),
      success: S.Array(Bill),
    }),
  )
  .add(
    HttpApiEndpoint.get("billingFamilyPayments", "/billing/families/:familyId/payments", {
      error: adminClientErrors,
      params: params("familyId"),
      success: S.Array(Payment),
    }),
  )
  .add(
    HttpApiEndpoint.get("billingFamilyCredits", "/billing/families/:familyId/credits", {
      error: adminClientErrors,
      params: params("familyId"),
      success: S.Array(AdminFamilyCredit),
    }),
  )
  .add(
    HttpApiEndpoint.post("createBill", "/billing/bills", {
      error: adminClientErrors,
      payload: CreateBillPayload,
      success: BillDetailResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getBill", "/billing/bills/:id", {
      error: adminClientErrors,
      params: params("id"),
      success: BillDetailResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("issueBill", "/billing/bills/:id/issue", {
      error: adminClientErrors,
      params: params("id"),
      success: BillDetailResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("cancelBill", "/billing/bills/:id/cancel", {
      error: adminClientErrors,
      params: params("id"),
      success: BillDetailResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("voidBill", "/billing/bills/:id/void", {
      error: adminClientErrors,
      params: params("id"),
      payload: VoidBillPayload,
      success: BillDetailResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("adjustBill", "/billing/bills/:id/adjust", {
      error: adminClientErrors,
      params: params("id"),
      payload: AdjustBillPayload,
      success: Adjustment,
    }),
  )
  .add(
    HttpApiEndpoint.post("recordPayment", "/billing/payments", {
      error: adminClientErrors,
      payload: RecordPaymentPayload,
      success: Payment,
    }),
  )
  .add(
    HttpApiEndpoint.post("refundPayment", "/billing/payments/:id/refund", {
      error: adminClientErrors,
      params: params("id"),
      payload: RefundPaymentPayload,
      success: Refund,
    }),
  )
  .add(
    HttpApiEndpoint.post("createCredit", "/billing/credits", {
      error: adminClientErrors,
      payload: CreateCreditPayload,
      success: AdminFamilyCredit,
    }),
  )
  .add(
    HttpApiEndpoint.post("applyCredit", "/billing/credits/apply", {
      error: adminClientErrors,
      payload: ApplyCreditPayload,
      success: CreditApplication,
    }),
  )
  .add(
    HttpApiEndpoint.get("familyDiscounts", "/billing/families/:familyId/discounts", {
      error: adminClientErrors,
      params: params("familyId"),
      success: S.Array(FamilyDiscount),
    }),
  )
  .add(
    HttpApiEndpoint.post("createDiscount", "/billing/discounts", {
      error: adminClientErrors,
      payload: CreateDiscountPayload,
      success: FamilyDiscount,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateDiscount", "/billing/discounts/:id", {
      error: adminClientErrors,
      params: params("id"),
      payload: UpdateDiscountPayload,
      success: FamilyDiscount,
    }),
  )
  .add(
    HttpApiEndpoint.get("listTaxRates", "/billing/tax-rates", {
      error: adminClientErrors,
      success: S.Array(TaxRate),
    }),
  )
  .add(
    HttpApiEndpoint.post("createTaxRate", "/billing/tax-rates", {
      error: adminClientErrors,
      payload: CreateTaxRatePayload,
      success: TaxRate,
    }),
  )
  .add(
    HttpApiEndpoint.get("familyTaxExemptions", "/billing/families/:familyId/tax-exemptions", {
      error: adminClientErrors,
      params: params("familyId"),
      success: S.Array(FamilyTaxExemption),
    }),
  )
  .add(
    HttpApiEndpoint.post("createTaxExemption", "/billing/tax-exemptions", {
      error: adminClientErrors,
      payload: CreateTaxExemptionPayload,
      success: FamilyTaxExemption,
    }),
  )
  .prefix("/api/admin");

const familyBillingErrors = [
  BadRequestErrorSchema,
  UnauthorizedErrorSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  InternalServerErrorSchema,
] as const;

export const familyBillingGroup = HttpApiGroup.make("familyBilling")
  .add(
    HttpApiEndpoint.get("overview", "/billing", {
      error: familyBillingErrors,
      success: FamilyBillingOverview,
    }),
  )
  .add(
    HttpApiEndpoint.get("bills", "/billing/bills", {
      error: familyBillingErrors,
      success: S.Array(FamilyBill),
    }),
  )
  .add(
    HttpApiEndpoint.get("billDetail", "/billing/bills/:id", {
      error: familyBillingErrors,
      params: params("id"),
      success: FamilyBillDetailResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("payments", "/billing/payments", {
      error: familyBillingErrors,
      success: S.Array(FamilyPayment),
    }),
  )
  .add(
    HttpApiEndpoint.get("paymentDetail", "/billing/payments/:id", {
      error: familyBillingErrors,
      params: params("id"),
      success: FamilyPaymentDetail,
    }),
  )
  .add(
    HttpApiEndpoint.get("credits", "/billing/credits", {
      error: familyBillingErrors,
      success: S.Array(FamilyCredit),
    }),
  )
  .add(
    HttpApiEndpoint.get("billPdf", "/billing/bills/:id/pdf", {
      error: familyBillingErrors,
      params: params("id"),
    }),
  )
  .add(
    HttpApiEndpoint.get("paymentReceipt", "/billing/payments/:id/receipt", {
      error: familyBillingErrors,
      params: params("id"),
    }),
  )
  .prefix("/api/family");

export const clientApi = HttpApi.make("dfg")
  .add(publicGroup)
  .add(authGroup)
  .add(authenticatedClientGroup)
  .add(adminClientGroup)
  .add(familyBillingGroup);
