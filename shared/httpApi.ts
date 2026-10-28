import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpApiSchema from "@effect/platform/HttpApiSchema";
import * as Multipart from "@effect/platform/Multipart";
import { Schema as S } from "effect";
import {
  Adjustment,
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

const AppleCallbackPayload = HttpApiSchema.Multipart(
  S.Struct({
    error: S.optional(S.String),
    code: S.optional(S.String),
    state: S.optional(S.String),
    user: S.optional(S.parseJson(AppleUserPayload)),
  }),
);

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
  body: S.String.pipe(S.minLength(20), S.maxLength(2000)),
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

const UploadMaterialPayload = HttpApiSchema.Multipart(
  S.Struct({
    file: Multipart.SingleFileSchema,
    title: S.String,
    is_global: S.BooleanFromString,
  }),
);

const SaveReminderIntervalPayload = S.Struct({
  interval_days: S.Number.pipe(S.between(1, 365)),
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
  rate_cents: S.Number.pipe(S.int(), S.positive()),
  lesson_duration_minutes: S.Union(S.Literal(30), S.Literal(60)),
  location_type: LocationType,
  billing_model: BillingModel,
  notes: S.optional(S.String),
});

export const CancelLessonPayload = S.Struct({
  reason: S.optional(S.String.pipe(S.maxLength(1000))),
});

export const RescheduleLessonPayload = S.Struct({
  scheduled_at: S.String,
});

export const CreatePracticeLogPayload = S.Struct({
  material_id: S.String,
  rating: S.optional(S.Number.pipe(S.between(1, 5))),
  duration_minutes: S.optional(S.Number),
});

export const RatePracticeLogPayload = S.Struct({
  material_id: S.String,
  rating: S.Number.pipe(S.between(1, 5)),
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
  day_of_week: S.Number.pipe(S.int(), S.between(1, 7)),
  local_start_time: S.String,
  timezone: S.String,
  starts_on: S.String,
  ends_on: S.optional(S.NullishOr(S.String)),
  active: S.optional(S.Boolean),
});

export type SaveRecurringSchedulePayload = S.Schema.Type<typeof SaveRecurringSchedulePayload>;

export const RecordMonthlyPaymentPayload = S.Struct({
  billing_month: S.String,
  amount_cents: S.Number.pipe(S.int(), S.positive()),
  paid_at: S.String,
  notes: S.optional(S.NullishOr(S.String)),
});

export type RecordMonthlyPaymentPayload = S.Schema.Type<typeof RecordMonthlyPaymentPayload>;

// Testing schemas
export const TestingLoginQuery = S.Struct({
  username: S.optional(S.String),
  password: S.optional(S.String),
  role: S.optional(
    S.Union(S.Literal("admin"), S.Literal("teacher"), S.Literal("student"), S.Literal("parent")),
  ),
  name: S.optional(S.String),
  email: S.optional(S.String),
});

export const TestingTestimonialReminderQuery = S.Struct({
  username: S.String,
  prompt_enabled: S.optional(S.BooleanFromString),
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
  is_owner: S.optional(S.BooleanFromString),
  is_billing_contact: S.optional(S.BooleanFromString),
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

export const publicGroup = HttpApiGroup.make("public")
  .addError(BadRequestErrorSchema)
  .addError(ForbiddenErrorSchema)
  .addError(NotFoundErrorSchema)
  .addError(ConflictErrorSchema)
  .addError(TooManyRequestsErrorSchema)
  .addError(InternalServerErrorSchema)
  .addError(BadGatewayErrorSchema)
  .addError(ServiceUnavailableErrorSchema)
  .add(HttpApiEndpoint.get("health", "/health").addSuccess(SuccessResponse))
  .add(
    HttpApiEndpoint.post("contact", "/contact")
      .setPayload(ContactPayload)
      .addSuccess(SuccessResponse),
  )
  .add(HttpApiEndpoint.get("oauthGoogle", "/oauth/google"))
  .add(HttpApiEndpoint.get("oauthGoogleCallback", "/oauth/google/callback"))
  .add(HttpApiEndpoint.get("oauthApple", "/oauth/apple"))
  .add(
    HttpApiEndpoint.post("oauthAppleCallback", "/oauth/apple/callback").setPayload(
      AppleCallbackPayload,
    ),
  )
  .add(
    HttpApiEndpoint.post("verifyEmail", "/verify-email")
      .setPayload(TokenPayload)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.get("invitation", "/invitation/:id")
      .setPath(params("id"))
      .setUrlParams(InvitationUrlParams)
      .addSuccess(InvitationResponse),
  )
  .add(
    HttpApiEndpoint.post("acceptInvitation", "/invitation/:id/accept")
      .setPath(params("id"))
      .setPayload(AcceptInvitationPayload)
      .addSuccess(User),
  )
  .prefix("/api");

export const authGroup = HttpApiGroup.make("auth")
  .addError(BadRequestErrorSchema)
  .addError(UnauthorizedErrorSchema)
  .addError(NotFoundErrorSchema)
  .addError(ConflictErrorSchema)
  .addError(LockedErrorSchema)
  .addError(TooManyRequestsErrorSchema)
  .addError(InternalServerErrorSchema)
  .add(HttpApiEndpoint.post("login", "/login").setPayload(LoginPayload).addSuccess(User))
  .add(
    HttpApiEndpoint.post("magicLink", "/magic-link")
      .setPayload(MagicLinkPayload)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("verifyMagicLink", "/magic-link/verify")
      .setPayload(VerifyMagicLinkPayload)
      .addSuccess(User),
  )
  .add(HttpApiEndpoint.post("logout", "/logout").addSuccess(SuccessResponse))
  .add(
    HttpApiEndpoint.post("forgotPassword", "/forgot-password")
      .setPayload(MagicLinkPayload)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("resetPassword", "/reset-password")
      .setPayload(ResetPasswordPayload)
      .addSuccess(SuccessResponse),
  )
  .add(HttpApiEndpoint.get("me", "/me").addSuccess(MeResponse))
  .add(
    HttpApiEndpoint.post("resendVerification", "/resend-verification").addSuccess(SuccessResponse),
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

export const authenticatedClientGroup = HttpApiGroup.make("authenticated")
  .addError(BadRequestErrorSchema)
  .addError(UnauthorizedErrorSchema)
  .addError(ForbiddenErrorSchema)
  .addError(NotFoundErrorSchema)
  .addError(ConflictErrorSchema)
  .addError(InternalServerErrorSchema)
  .addError(BadGatewayErrorSchema)
  .addError(ServiceUnavailableErrorSchema)
  .add(HttpApiEndpoint.get("courses", "/courses").addSuccess(S.Array(Course)))
  .add(
    HttpApiEndpoint.get("courseById", "/courses/:id")
      .setPath(params("id"))
      .addSuccess(CourseDetail),
  )
  .add(
    HttpApiEndpoint.get("library", "/library")
      .setUrlParams(PaginationQuery)
      .addSuccess(S.Array(Material)),
  )
  .add(HttpApiEndpoint.get("assignments", "/assignments").addSuccess(S.Array(AssignedMaterial)))
  .add(
    HttpApiEndpoint.post("assignStudentMaterial", "/assignments/students/:studentId/assign")
      .setPath(params("studentId"))
      .setPayload(AssignStudentMaterialPayload)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.del(
      "unassignStudentMaterial",
      "/assignments/students/:studentId/assign/:materialId",
    )
      .setPath(params("studentId", "materialId"))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.get("practiceLogs", "/practice-logs")
      .setUrlParams(PracticeLogQuery)
      .addSuccess(S.Array(PracticeLog)),
  )
  .add(
    HttpApiEndpoint.post("createPracticeLog", "/practice-logs")
      .setPayload(CreatePracticeLogPayload)
      .addSuccess(PracticeLog),
  )
  .add(
    HttpApiEndpoint.post("ratePracticeLog", "/practice-logs/rate")
      .setPayload(RatePracticeLogPayload)
      .addSuccess(PracticeLog),
  )
  .add(
    HttpApiEndpoint.post("recordAssignmentPlayback", "/assignments/:materialId/playback")
      .setPath(params("materialId"))
      .setPayload(RecordAssignmentPlaybackPayload)
      .addSuccess(AssignmentProgress),
  )
  .add(
    HttpApiEndpoint.post("createAssignmentReview", "/assignments/:materialId/reviews")
      .setPath(params("materialId"))
      .setPayload(CreateAssignmentReviewPayload)
      .addSuccess(AssignmentReview),
  )
  .add(
    HttpApiEndpoint.get("assignmentNotes", "/assignments/:materialId/notes")
      .setPath(params("materialId"))
      .addSuccess(S.NullOr(AssignmentNote)),
  )
  .add(
    HttpApiEndpoint.put("upsertAssignmentNotes", "/assignments/:materialId/notes")
      .setPath(params("materialId"))
      .setPayload(AssignmentNotePayload)
      .addSuccess(AssignmentNote),
  )
  .add(
    HttpApiEndpoint.get("messages", "/messages")
      .setUrlParams(MessageListQuery)
      .addSuccess(S.Array(Message)),
  )
  .add(
    HttpApiEndpoint.post("createMessage", "/messages")
      .setPayload(CreateMessagePayload)
      .addSuccess(Message),
  )
  .add(
    HttpApiEndpoint.patch("markMessageRead", "/messages/:id")
      .setPath(params("id"))
      .setPayload(MarkMessageReadPayload)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.get("myLessons", "/my-lessons")
      .setUrlParams(MyLessonsQuery)
      .addSuccess(S.Array(Lesson)),
  )
  .add(
    HttpApiEndpoint.get("myLessonCancellationPolicy", "/my-lessons/:id/cancellation-policy")
      .setPath(params("id"))
      .addSuccess(LessonCancellationPolicy),
  )
  .add(
    HttpApiEndpoint.post("cancelMyLesson", "/my-lessons/:id/cancel")
      .setPath(params("id"))
      .setPayload(CancelLessonPayload)
      .addSuccess(Lesson),
  )
  .add(
    HttpApiEndpoint.post("rescheduleMyLesson", "/my-lessons/:id/reschedule")
      .setPath(params("id"))
      .setPayload(RescheduleLessonPayload)
      .addSuccess(Lesson),
  )
  .add(
    HttpApiEndpoint.post("requestDeleteAccount", "/request-delete-account")
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("confirmDeleteAccount", "/confirm-delete-account")
      .setPayload(ConfirmDeleteAccountPayload)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.get("myLessonNotesList", "/my-lesson-notes")
      .setUrlParams(PaginationQuery)
      .addSuccess(S.Array(LessonNote)),
  )
  .add(HttpApiEndpoint.get("myEmails", "/me/emails").addSuccess(S.Array(UserEmail)))
  .add(
    HttpApiEndpoint.post("addMyEmail", "/me/emails")
      .setPayload(AddEmailPayload)
      .addSuccess(UserEmail),
  )
  .add(
    HttpApiEndpoint.del("deleteMyEmail", "/me/emails/:id")
      .setPath(params("id"))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("makePrimaryEmail", "/me/emails/:id/make-primary")
      .setPath(params("id"))
      .addSuccess(UserEmail),
  )
  .add(
    HttpApiEndpoint.post("resendEmailVerification", "/me/emails/:id/resend-verification")
      .setPath(params("id"))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.put("upsertTestimonial", "/testimonials")
      .setPayload(TestimonialPayload)
      .addSuccess(Testimonial),
  )
  .add(HttpApiEndpoint.del("deleteTestimonial", "/testimonials").addSuccess(SuccessResponse))
  .add(
    HttpApiEndpoint.get("availableSlots", "/available-slots")
      .setUrlParams(AvailableSlotsQuery)
      .addSuccess(S.Array(TimeSlot)),
  )
  .add(
    HttpApiEndpoint.post("bookLesson", "/my-lessons/book")
      .setPayload(BookLessonPayload)
      .addSuccess(Lesson),
  )
  .add(
    HttpApiEndpoint.post("switchActiveStudent", "/switch-active-student")
      .setPayload(SwitchActiveStudentPayload)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("createChild", "/create-child")
      .setPayload(CreateChildPayload)
      .addSuccess(CreateChildResponse),
  )
  .add(
    HttpApiEndpoint.get("family", "/family").addSuccess(FamilyInfo),
  )
  .add(
    HttpApiEndpoint.post("removeFamilyMember", "/family/remove-member")
      .setPayload(RemoveMemberPayload)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("inviteFamilyMember", "/family/invite")
      .setPayload(InviteFamilyMemberPayload)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("setChildEmail", "/family/child/:childId/email")
      .setPath(params("childId"))
      .setPayload(SetChildEmailPayload)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("requestChildPasswordSet", "/family/child/:childId/request-password-set")
      .setPath(params("childId"))
      .addSuccess(ChildPasswordResetTokenResponse),
  )
  .add(
    HttpApiEndpoint.post("setChildPassword", "/family/child/:childId/set-password")
      .setPath(params("childId"))
      .setPayload(SetChildPasswordPayload)
      .addSuccess(SuccessResponse),
  )
  .prefix("/api");

export const SaveCancellationPolicySettingsPayload = S.Struct({
  cancellation_window_hours: S.Number.pipe(S.between(0, 720)),
  late_cancel_charge_percent: S.Number.pipe(S.between(0, 100)),
});

// Billing payloads

const CreateBillLineItemPayload = S.Struct({
  student_id: S.String,
  line_type: S.Union(
    S.Literal("lesson"),
    S.Literal("single_booking"),
    S.Literal("fee"),
    S.Literal("adjustment"),
    S.Literal("credit"),
  ),
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
  reason: S.String.pipe(S.minLength(1)),
});

const AdjustBillPayload = S.Struct({
  amount_cents: S.Number,
  reason: S.String.pipe(S.minLength(1)),
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
  reason: S.String.pipe(S.minLength(1)),
  expires_at: S.optional(S.String),
});

const ApplyCreditPayload = S.Struct({
  credit_id: S.String,
  bill_id: S.String,
  amount_cents: S.Number,
});

const RefundPaymentPayload = S.Struct({
  amount_cents: S.Number,
  reason: S.String.pipe(S.minLength(1)),
});

const CreateDiscountPayload = S.Struct({
  family_id: S.String,
  label: S.String,
  discount_type: S.Union(S.Literal("percentage"), S.Literal("fixed")),
  discount_value: S.Number,
  applies_to: S.Union(S.Literal("all"), S.Literal("tuition"), S.Literal("fees")),
  effective_from: S.String,
  effective_until: S.optional(S.String),
});

const UpdateDiscountPayload = S.Struct({
  label: S.optional(S.String),
  discount_type: S.optional(S.Union(S.Literal("percentage"), S.Literal("fixed"))),
  discount_value: S.optional(S.Number),
  applies_to: S.optional(S.Union(S.Literal("all"), S.Literal("tuition"), S.Literal("fees"))),
  effective_from: S.optional(S.String),
  effective_until: S.optional(S.String),
  is_active: S.optional(S.Boolean),
});

const CreateTaxRatePayload = S.Struct({
  label: S.String,
  jurisdiction: S.String,
  rate_percent: S.Number.pipe(S.between(0, 30)),
  applies_to: S.Union(S.Literal("all"), S.Literal("tuition"), S.Literal("fees")),
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

export const adminClientGroup = HttpApiGroup.make("admin")
  .addError(BadRequestErrorSchema)
  .addError(UnauthorizedErrorSchema)
  .addError(ForbiddenErrorSchema)
  .addError(NotFoundErrorSchema)
  .addError(ConflictErrorSchema)
  .addError(PayloadTooLargeErrorSchema)
  .addError(InternalServerErrorSchema)
  .addError(BadGatewayErrorSchema)
  .addError(ServiceUnavailableErrorSchema)
  .add(
    HttpApiEndpoint.get("submissions", "/submissions")
      .setUrlParams(PaginationQuery)
      .addSuccess(S.Array(Submission)),
  )
  .add(
    HttpApiEndpoint.patch("updateSubmission", "/submissions/:id")
      .setPath(params("id"))
      .setPayload(UpdateSubmissionPayload)
      .addSuccess(SuccessResponse),
  )
  .add(HttpApiEndpoint.get("students", "/students").addSuccess(S.Array(User)))
  .add(
    HttpApiEndpoint.get("student", "/students/:id").setPath(params("id")).addSuccess(StudentDetail),
  )
  .add(HttpApiEndpoint.get("courses", "/courses").addSuccess(S.Array(Course)))
  .add(
    HttpApiEndpoint.get("courseStudents", "/courses/:id/students")
      .setPath(params("id"))
      .addSuccess(S.Array(User)),
  )
  .add(
    HttpApiEndpoint.post("createCourse", "/courses")
      .setPayload(CreateCoursePayload)
      .addSuccess(Course),
  )
  .add(
    HttpApiEndpoint.patch("updateCourse", "/courses/:id")
      .setPath(params("id"))
      .setPayload(UpdateCoursePayload)
      .addSuccess(Course),
  )
  .add(
    HttpApiEndpoint.del("deleteCourse", "/courses/:id")
      .setPath(params("id"))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("createModule", "/courses/:id/modules")
      .setPath(params("id"))
      .setPayload(CreateModulePayload)
      .addSuccess(Module),
  )
  .add(
    HttpApiEndpoint.patch("updateModule", "/modules/:id")
      .setPath(params("id"))
      .setPayload(UpdateModulePayload)
      .addSuccess(Module),
  )
  .add(
    HttpApiEndpoint.del("deleteModule", "/modules/:id")
      .setPath(params("id"))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("enrollStudent", "/students/:id/enroll")
      .setPath(params("id"))
      .setPayload(EnrollStudentPayload)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.del("unenrollStudent", "/students/:id/enroll/:courseId")
      .setPath(params("id", "courseId"))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("assignMaterial", "/students/:id/assign")
      .setPath(params("id"))
      .setPayload(AssignStudentMaterialPayload)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.del("unassignMaterial", "/students/:id/assign/:materialId")
      .setPath(params("id", "materialId"))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.del("deleteMaterial", "/materials/:id")
      .setPath(params("id"))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("uploadMaterial", "/materials/upload")
      .setPayload(UploadMaterialPayload)
      .addSuccess(Material),
  )
  .add(HttpApiEndpoint.get("families", "/families").addSuccess(S.Array(Family)))
  .add(
    HttpApiEndpoint.post("createFamily", "/families")
      .setPayload(CreateFamilyPayload)
      .addSuccess(Family),
  )
  .add(
    HttpApiEndpoint.post("inviteFamily", "/families/:familyId/invite")
      .setPath(params("familyId"))
      .setPayload(InviteFamilyPayload)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("qrInvite", "/families/:familyId/qr-invite")
      .setPath(params("familyId"))
      .setPayload(QrInvitePayload)
      .addSuccess(QrInviteResponse),
  )
  .add(
    HttpApiEndpoint.get("familyInvitations", "/families/:familyId/invitations")
      .setPath(params("familyId"))
      .addSuccess(S.Array(FamilyInvitation)),
  )
  .add(
    HttpApiEndpoint.post("saveStudentRate", "/student-rates")
      .setPayload(SaveStudentRatePayload)
      .addSuccess(StudentRate),
  )
  .add(
    HttpApiEndpoint.get("studentRates", "/student-rates/:studentId")
      .setPath(params("studentId"))
      .setUrlParams(StudentRatesQuery)
      .addSuccess(S.Array(StudentRate)),
  )
  .add(
    HttpApiEndpoint.get("recurringSchedules", "/students/:studentId/recurring-schedules")
      .setPath(params("studentId"))
      .addSuccess(S.Array(RecurringSchedule)),
  )
  .add(
    HttpApiEndpoint.post("saveRecurringSchedule", "/students/:studentId/recurring-schedules")
      .setPath(params("studentId"))
      .setPayload(SaveRecurringSchedulePayload)
      .addSuccess(RecurringSchedule),
  )
  .add(
    HttpApiEndpoint.get("monthlyPayments", "/students/:studentId/monthly-payments")
      .setPath(params("studentId"))
      .addSuccess(S.Array(MonthlyPayment)),
  )
  .add(
    HttpApiEndpoint.post("recordMonthlyPayment", "/students/:studentId/monthly-payments")
      .setPath(params("studentId"))
      .setPayload(RecordMonthlyPaymentPayload)
      .addSuccess(MonthlyPayment),
  )
  .add(
    HttpApiEndpoint.post("createLesson", "/lessons")
      .setPayload(CreateLessonPayload)
      .addSuccess(Lesson),
  )
  .add(
    HttpApiEndpoint.patch("updateLesson", "/lessons/:id")
      .setPath(params("id"))
      .setPayload(UpdateLessonPayload)
      .addSuccess(Lesson),
  )
  .add(
    HttpApiEndpoint.get("lessons", "/lessons")
      .setUrlParams(AdminLessonsQuery)
      .addSuccess(S.Array(Lesson)),
  )
  .add(
    HttpApiEndpoint.post("cancelLesson", "/lessons/:id/cancel")
      .setPath(params("id"))
      .setPayload(CancelLessonPayload)
      .addSuccess(Lesson),
  )
  .add(
    HttpApiEndpoint.post("completeLesson", "/lessons/:id/complete")
      .setPath(params("id"))
      .addSuccess(Lesson),
  )
  .add(
    HttpApiEndpoint.del("deleteLesson", "/lessons/:id")
      .setPath(params("id"))
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.post("saveLessonNote", "/lessons/:id/notes")
      .setPath(params("id"))
      .setPayload(SaveLessonNotePayload)
      .addSuccess(LessonNote),
  )
  .add(
    HttpApiEndpoint.get("lessonNote", "/lessons/:id/notes")
      .setPath(params("id"))
      .addSuccess(LessonNote),
  )
  .add(
    HttpApiEndpoint.patch("publishLessonNote", "/lessons/:id/notes/publish")
      .setPath(params("id"))
      .addSuccess(LessonNote),
  )
  .add(HttpApiEndpoint.get("gcalStatus", "/gcal/status").addSuccess(GcalStatus))
  .add(HttpApiEndpoint.post("gcalDisconnect", "/gcal/disconnect").addSuccess(SuccessResponse))
  .add(HttpApiEndpoint.get("workingHours", "/working-hours").addSuccess(WorkingHours))
  .add(
    HttpApiEndpoint.get("cancellationPolicySettings", "/cancellation-policy").addSuccess(
      CancellationPolicySettings,
    ),
  )
  .add(
    HttpApiEndpoint.post("saveCancellationPolicySettings", "/cancellation-policy")
      .setPayload(SaveCancellationPolicySettingsPayload)
      .addSuccess(CancellationPolicySettings),
  )
  .add(
    HttpApiEndpoint.post("saveWorkingHours", "/working-hours")
      .setPayload(WorkingHours)
      .addSuccess(SuccessResponse),
  )
  .add(
    HttpApiEndpoint.get("testimonialReminderInterval", "/testimonial-reminder-interval")
      .addSuccess(TestimonialReminderIntervalResponse),
  )
  .add(
    HttpApiEndpoint.post("saveTestimonialReminderInterval", "/testimonial-reminder-interval")
      .setPayload(SaveReminderIntervalPayload)
      .addSuccess(ReminderIntervalResponse),
  )
  .add(
    HttpApiEndpoint.patch("updateTestimonialApproval", "/testimonials/:id")
      .setPath(params("id"))
      .setPayload(UpdateTestimonialApprovalPayload)
      .addSuccess(SuccessResponse),
  )
  // Billing endpoints
  .add(
    HttpApiEndpoint.get("billingFamilies", "/billing/families")
      .addSuccess(S.Array(FamilyBillingSummary)),
  )
  .add(
    HttpApiEndpoint.get("billingFamily", "/billing/families/:familyId")
      .setPath(params("familyId"))
      .addSuccess(FamilyBillingDetail),
  )
  .add(
    HttpApiEndpoint.get("billingFamilyBills", "/billing/families/:familyId/bills")
      .setPath(params("familyId"))
      .addSuccess(S.Array(Bill)),
  )
  .add(
    HttpApiEndpoint.get("billingFamilyPayments", "/billing/families/:familyId/payments")
      .setPath(params("familyId"))
      .addSuccess(S.Array(Payment)),
  )
  .add(
    HttpApiEndpoint.get("billingFamilyCredits", "/billing/families/:familyId/credits")
      .setPath(params("familyId"))
      .addSuccess(S.Array(AdminFamilyCredit)),
  )
  .add(
    HttpApiEndpoint.post("createBill", "/billing/bills")
      .setPayload(CreateBillPayload)
      .addSuccess(BillDetailResponse),
  )
  .add(
    HttpApiEndpoint.get("getBill", "/billing/bills/:id")
      .setPath(params("id"))
      .addSuccess(BillDetailResponse),
  )
  .add(
    HttpApiEndpoint.post("issueBill", "/billing/bills/:id/issue")
      .setPath(params("id"))
      .addSuccess(BillDetailResponse),
  )
  .add(
    HttpApiEndpoint.post("cancelBill", "/billing/bills/:id/cancel")
      .setPath(params("id"))
      .addSuccess(BillDetailResponse),
  )
  .add(
    HttpApiEndpoint.post("voidBill", "/billing/bills/:id/void")
      .setPath(params("id"))
      .setPayload(VoidBillPayload)
      .addSuccess(BillDetailResponse),
  )
  .add(
    HttpApiEndpoint.post("adjustBill", "/billing/bills/:id/adjust")
      .setPath(params("id"))
      .setPayload(AdjustBillPayload)
      .addSuccess(Adjustment),
  )
  .add(
    HttpApiEndpoint.post("recordPayment", "/billing/payments")
      .setPayload(RecordPaymentPayload)
      .addSuccess(Payment),
  )
  .add(
    HttpApiEndpoint.post("refundPayment", "/billing/payments/:id/refund")
      .setPath(params("id"))
      .setPayload(RefundPaymentPayload)
      .addSuccess(Refund),
  )
  .add(
    HttpApiEndpoint.post("createCredit", "/billing/credits")
      .setPayload(CreateCreditPayload)
      .addSuccess(AdminFamilyCredit),
  )
  .add(
    HttpApiEndpoint.post("applyCredit", "/billing/credits/apply")
      .setPayload(ApplyCreditPayload)
      .addSuccess(CreditApplication),
  )
  .add(
    HttpApiEndpoint.get("familyDiscounts", "/billing/families/:familyId/discounts")
      .setPath(params("familyId"))
      .addSuccess(S.Array(FamilyDiscount)),
  )
  .add(
    HttpApiEndpoint.post("createDiscount", "/billing/discounts")
      .setPayload(CreateDiscountPayload)
      .addSuccess(FamilyDiscount),
  )
  .add(
    HttpApiEndpoint.patch("updateDiscount", "/billing/discounts/:id")
      .setPath(params("id"))
      .setPayload(UpdateDiscountPayload)
      .addSuccess(FamilyDiscount),
  )
  .add(
    HttpApiEndpoint.get("listTaxRates", "/billing/tax-rates")
      .addSuccess(S.Array(TaxRate)),
  )
  .add(
    HttpApiEndpoint.post("createTaxRate", "/billing/tax-rates")
      .setPayload(CreateTaxRatePayload)
      .addSuccess(TaxRate),
  )
  .add(
    HttpApiEndpoint.get("familyTaxExemptions", "/billing/families/:familyId/tax-exemptions")
      .setPath(params("familyId"))
      .addSuccess(S.Array(FamilyTaxExemption)),
  )
  .add(
    HttpApiEndpoint.post("createTaxExemption", "/billing/tax-exemptions")
      .setPayload(CreateTaxExemptionPayload)
      .addSuccess(FamilyTaxExemption),
  )
  .prefix("/api/admin");

export const familyBillingGroup = HttpApiGroup.make("familyBilling")
  .addError(BadRequestErrorSchema)
  .addError(UnauthorizedErrorSchema)
  .addError(ForbiddenErrorSchema)
  .addError(NotFoundErrorSchema)
  .addError(InternalServerErrorSchema)
  .add(
    HttpApiEndpoint.get("overview", "/billing")
      .addSuccess(FamilyBillingOverview),
  )
  .add(
  HttpApiEndpoint.get("bills", "/billing/bills")
      .addSuccess(S.Array(FamilyBill)),
  )
  .add(
    HttpApiEndpoint.get("billDetail", "/billing/bills/:id")
      .setPath(params("id"))
      .addSuccess(FamilyBillDetailResponse),
  )
  .add(
  HttpApiEndpoint.get("payments", "/billing/payments")
      .addSuccess(S.Array(FamilyPayment)),
  )
  .add(
    HttpApiEndpoint.get("paymentDetail", "/billing/payments/:id")
      .setPath(params("id"))
      .addSuccess(FamilyPaymentDetail),
  )
  .add(
    HttpApiEndpoint.get("credits", "/billing/credits")
      .addSuccess(S.Array(FamilyCredit)),
  )
  .add(
    HttpApiEndpoint.get("billPdf", "/billing/bills/:id/pdf")
      .setPath(params("id")),
  )
  .add(
    HttpApiEndpoint.get("paymentReceipt", "/billing/payments/:id/receipt")
      .setPath(params("id")),
  )
  .prefix("/api/family");

export const clientApi = HttpApi.make("dfg")
  .add(publicGroup)
  .add(authGroup)
  .add(authenticatedClientGroup)
  .add(adminClientGroup)
  .add(familyBillingGroup);
