import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpApiSchema from "@effect/platform/HttpApiSchema";
import * as Multipart from "@effect/platform/Multipart";
import { Schema as S } from "effect";
import {
  ApiError,
  AssignedMaterial,
  AssignmentNote,
  AssignmentProgress,
  AssignmentReview,
  Course,
  CourseDetail,
  Family,
  GcalStatus,
  Lesson,
  LessonNote,
  Material,
  Message,
  Module,
  PracticeLog,
  Submission,
  StudentDetail,
  Testimonial,
  TimeSlot,
  User,
  UserEmail,
  WorkingHours,
} from "./schemas.js";

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
const MeResponse = S.Struct({
  user: S.NullOr(User),
});

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
  role: S.optional(S.Union(S.Literal("parent"), S.Literal("student"))),
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
  status: S.optional(
    S.Union(
      S.Literal("scheduled"),
      S.Literal("completed"),
      S.Literal("cancelled"),
      S.Literal("no_show"),
    ),
  ),
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
  location_type: S.Union(
    S.Literal("in_person_teacher_travels"),
    S.Literal("in_person_student_travels"),
    S.Literal("studio"),
    S.Literal("online"),
  ),
});
const AddEmailPayload = S.Struct({
  email: S.String,
});
const TestimonialPayload = S.Struct({
  body: S.String,
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
  content: S.optional(S.Unknown),
  sort_order: S.optional(S.Number),
});
const EnrollStudentPayload = S.Struct({
  course_id: S.String,
});
const InviteFamilyPayload = S.Struct({
  username: S.optional(S.String),
  email: S.optional(S.String),
});
const QrInvitePayload = S.Struct({
  name: S.optional(S.String),
  slug: S.optional(S.String),
});
const CreateLessonPayload = S.Struct({
  student_id: S.String,
  scheduled_at: S.String,
  duration_minutes: S.Number,
  location_type: S.Union(
    S.Literal("in_person_teacher_travels"),
    S.Literal("in_person_student_travels"),
    S.Literal("studio"),
    S.Literal("online"),
  ),
});
const UpdateLessonPayload = S.Struct({
  scheduled_at: S.optional(S.String),
  duration_minutes: S.optional(S.Number),
  location_type: S.optional(
    S.Union(
      S.Literal("in_person_teacher_travels"),
      S.Literal("in_person_student_travels"),
      S.Literal("studio"),
      S.Literal("online"),
    ),
  ),
  status: S.optional(
    S.Union(
      S.Literal("scheduled"),
      S.Literal("completed"),
      S.Literal("cancelled"),
      S.Literal("no_show"),
    ),
  ),
  cancellation_reason: S.optional(S.String),
});
const AdminLessonsQuery = S.Struct({
  limit: S.optional(S.NumberFromString),
  offset: S.optional(S.NumberFromString),
  student_id: S.optional(S.String),
  status: S.optional(
    S.Union(
      S.Literal("scheduled"),
      S.Literal("completed"),
      S.Literal("cancelled"),
      S.Literal("no_show"),
    ),
  ),
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
  interval_days: S.Number,
});
const UpdateTestimonialApprovalPayload = S.Struct({
  is_approved: S.Boolean,
});

export const publicGroup = HttpApiGroup.make("public")
  .addError(ApiError, { status: 400 })
  .addError(ApiError, { status: 404 })
  .addError(ApiError, { status: 409 })
  .addError(ApiError, { status: 500 })
  .addError(ApiError, { status: 502 })
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
  .addError(ApiError, { status: 400 })
  .addError(ApiError, { status: 401 })
  .addError(ApiError, { status: 403 })
  .addError(ApiError, { status: 404 })
  .addError(ApiError, { status: 409 })
  .addError(ApiError, { status: 500 })
  .add(
    HttpApiEndpoint.post("login", "/login")
      .setPayload(LoginPayload)
      .addSuccess(User),
  )
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
    HttpApiEndpoint.post("resendVerification", "/resend-verification").addSuccess(
      SuccessResponse,
    ),
  )
  .prefix("/api");

export const courses = HttpApiEndpoint.get("courses", "/courses").addSuccess(
  S.Array(Course),
);
export const courseById = HttpApiEndpoint.get("courseById", "/courses/:id")
  .setPath(params("id"))
  .addSuccess(CourseDetail);
export const library = HttpApiEndpoint.get("library", "/library")
  .setUrlParams(PaginationQuery)
  .addSuccess(S.Array(Material));
export const assignments = HttpApiEndpoint.get("assignments", "/assignments").addSuccess(
  S.Array(AssignedMaterial),
);
export const assignStudentMaterial = HttpApiEndpoint.post(
  "assignStudentMaterial",
  "/assignments/students/:studentId/assign",
)
  .setPath(params("studentId"))
  .setPayload(AssignStudentMaterialPayload)
  .addSuccess(SuccessResponse);
export const unassignStudentMaterial = HttpApiEndpoint.del(
  "unassignStudentMaterial",
  "/assignments/students/:studentId/assign/:materialId",
)
  .setPath(params("studentId", "materialId"))
  .addSuccess(SuccessResponse);
export const practiceLogs = HttpApiEndpoint.get("practiceLogs", "/practice-logs")
  .setUrlParams(PracticeLogQuery)
  .addSuccess(S.Array(PracticeLog));
export const recordAssignmentPlayback = HttpApiEndpoint.post(
  "recordAssignmentPlayback",
  "/assignments/:materialId/playback",
)
  .setPath(params("materialId"))
  .setPayload(RecordAssignmentPlaybackPayload)
  .addSuccess(AssignmentProgress);
export const createAssignmentReview = HttpApiEndpoint.post(
  "createAssignmentReview",
  "/assignments/:materialId/reviews",
)
  .setPath(params("materialId"))
  .setPayload(CreateAssignmentReviewPayload)
  .addSuccess(AssignmentReview);
export const assignmentNotes = HttpApiEndpoint.get(
  "assignmentNotes",
  "/assignments/:materialId/notes",
)
  .setPath(params("materialId"))
  .addSuccess(S.NullOr(AssignmentNote));
export const upsertAssignmentNotes = HttpApiEndpoint.put(
  "upsertAssignmentNotes",
  "/assignments/:materialId/notes",
)
  .setPath(params("materialId"))
  .setPayload(AssignmentNotePayload)
  .addSuccess(AssignmentNote);
export const messages = HttpApiEndpoint.get("messages", "/messages")
  .setUrlParams(MessageListQuery)
  .addSuccess(S.Array(Message));
export const createMessage = HttpApiEndpoint.post("createMessage", "/messages")
  .setPayload(CreateMessagePayload)
  .addSuccess(Message);
export const markMessageRead = HttpApiEndpoint.patch("markMessageRead", "/messages/:id")
  .setPath(params("id"))
  .setPayload(MarkMessageReadPayload)
  .addSuccess(SuccessResponse);
export const myLessons = HttpApiEndpoint.get("myLessons", "/my-lessons")
  .setUrlParams(MyLessonsQuery)
  .addSuccess(S.Array(Lesson));
export const confirmDeleteAccount = HttpApiEndpoint.post(
  "confirmDeleteAccount",
  "/confirm-delete-account",
)
  .setPayload(ConfirmDeleteAccountPayload)
  .addSuccess(SuccessResponse);
export const myLessonNotesList = HttpApiEndpoint.get(
  "myLessonNotesList",
  "/my-lesson-notes",
)
  .setUrlParams(PaginationQuery)
  .addSuccess(S.Array(LessonNote));
export const myEmails = HttpApiEndpoint.get("myEmails", "/me/emails").addSuccess(
  S.Array(UserEmail),
);
export const addMyEmail = HttpApiEndpoint.post("addMyEmail", "/me/emails")
  .setPayload(AddEmailPayload)
  .addSuccess(UserEmail);
export const deleteMyEmail = HttpApiEndpoint.del("deleteMyEmail", "/me/emails/:id")
  .setPath(params("id"))
  .addSuccess(SuccessResponse);
export const makePrimaryEmail = HttpApiEndpoint.post(
  "makePrimaryEmail",
  "/me/emails/:id/make-primary",
)
  .setPath(params("id"))
  .addSuccess(UserEmail);
export const resendEmailVerification = HttpApiEndpoint.post(
  "resendEmailVerification",
  "/me/emails/:id/resend-verification",
)
  .setPath(params("id"))
  .addSuccess(SuccessResponse);
export const upsertTestimonial = HttpApiEndpoint.put("upsertTestimonial", "/testimonials")
  .setPayload(TestimonialPayload)
  .addSuccess(Testimonial);
export const deleteTestimonial = HttpApiEndpoint.del(
  "deleteTestimonial",
  "/testimonials",
).addSuccess(SuccessResponse);
export const availableSlots = HttpApiEndpoint.get(
  "availableSlots",
  "/available-slots",
)
  .setUrlParams(AvailableSlotsQuery)
  .addSuccess(S.Array(TimeSlot));
export const bookLesson = HttpApiEndpoint.post("bookLesson", "/my-lessons/book")
  .setPayload(BookLessonPayload)
  .addSuccess(Lesson);

export type AuthenticatedClientEndpoint =
  | typeof courses
  | typeof courseById
  | typeof library
  | typeof assignments
  | typeof assignStudentMaterial
  | typeof unassignStudentMaterial
  | typeof practiceLogs
  | typeof recordAssignmentPlayback
  | typeof createAssignmentReview
  | typeof assignmentNotes
  | typeof upsertAssignmentNotes
  | typeof messages
  | typeof createMessage
  | typeof markMessageRead
  | typeof myLessons
  | typeof confirmDeleteAccount
  | typeof myLessonNotesList
  | typeof myEmails
  | typeof addMyEmail
  | typeof deleteMyEmail
  | typeof makePrimaryEmail
  | typeof resendEmailVerification
  | typeof upsertTestimonial
  | typeof deleteTestimonial
  | typeof availableSlots
  | typeof bookLesson;

export const authenticatedClientGroup = HttpApiGroup.make("authenticated")
  .addError(ApiError, { status: 400 })
  .addError(ApiError, { status: 401 })
  .addError(ApiError, { status: 403 })
  .addError(ApiError, { status: 404 })
  .addError(ApiError, { status: 409 })
  .addError(ApiError, { status: 500 })
  .add(courses)
  .add(courseById)
  .add(library)
  .add(assignments)
  .add(assignStudentMaterial)
  .add(unassignStudentMaterial)
  .add(practiceLogs)
  .add(recordAssignmentPlayback)
  .add(createAssignmentReview)
  .add(assignmentNotes)
  .add(upsertAssignmentNotes)
  .add(messages)
  .add(createMessage)
  .add(markMessageRead)
  .add(myLessons)
  .add(confirmDeleteAccount)
  .add(myLessonNotesList)
  .add(myEmails)
  .add(addMyEmail)
  .add(deleteMyEmail)
  .add(makePrimaryEmail)
  .add(resendEmailVerification)
  .add(upsertTestimonial)
  .add(deleteTestimonial)
  .add(availableSlots)
  .add(bookLesson)
  .prefix("/api");

export const submissions = HttpApiEndpoint.get("submissions", "/submissions")
  .setUrlParams(PaginationQuery)
  .addSuccess(S.Array(Submission));
export const updateSubmission = HttpApiEndpoint.patch(
  "updateSubmission",
  "/submissions/:id",
)
  .setPath(params("id"))
  .setPayload(UpdateSubmissionPayload)
  .addSuccess(SuccessResponse);
export const students = HttpApiEndpoint.get("students", "/students").addSuccess(
  S.Array(User),
);
export const student = HttpApiEndpoint.get("student", "/students/:id")
  .setPath(params("id"))
  .addSuccess(StudentDetail);
export const adminCourses = HttpApiEndpoint.get("courses", "/courses").addSuccess(
  S.Array(Course),
);
export const courseStudents = HttpApiEndpoint.get(
  "courseStudents",
  "/courses/:id/students",
)
  .setPath(params("id"))
  .addSuccess(S.Array(User));
export const createCourse = HttpApiEndpoint.post("createCourse", "/courses")
  .setPayload(CreateCoursePayload)
  .addSuccess(Course);
export const updateCourse = HttpApiEndpoint.patch("updateCourse", "/courses/:id")
  .setPath(params("id"))
  .setPayload(UpdateCoursePayload)
  .addSuccess(Course);
export const deleteCourse = HttpApiEndpoint.del("deleteCourse", "/courses/:id")
  .setPath(params("id"))
  .addSuccess(SuccessResponse);
export const createModule = HttpApiEndpoint.post("createModule", "/courses/:id/modules")
  .setPath(params("id"))
  .setPayload(CreateModulePayload)
  .addSuccess(Module);
export const updateModule = HttpApiEndpoint.patch("updateModule", "/modules/:id")
  .setPath(params("id"))
  .setPayload(UpdateModulePayload)
  .addSuccess(Module);
export const deleteModule = HttpApiEndpoint.del("deleteModule", "/modules/:id")
  .setPath(params("id"))
  .addSuccess(SuccessResponse);
export const enrollStudent = HttpApiEndpoint.post("enrollStudent", "/students/:id/enroll")
  .setPath(params("id"))
  .setPayload(EnrollStudentPayload)
  .addSuccess(SuccessResponse);
export const unenrollStudent = HttpApiEndpoint.del(
  "unenrollStudent",
  "/students/:id/enroll/:courseId",
)
  .setPath(params("id", "courseId"))
  .addSuccess(SuccessResponse);
export const assignMaterial = HttpApiEndpoint.post(
  "assignMaterial",
  "/students/:id/assign",
)
  .setPath(params("id"))
  .setPayload(AssignStudentMaterialPayload)
  .addSuccess(SuccessResponse);
export const unassignMaterial = HttpApiEndpoint.del(
  "unassignMaterial",
  "/students/:id/assign/:materialId",
)
  .setPath(params("id", "materialId"))
  .addSuccess(SuccessResponse);
export const deleteMaterial = HttpApiEndpoint.del("deleteMaterial", "/materials/:id")
  .setPath(params("id"))
  .addSuccess(SuccessResponse);
export const uploadMaterial = HttpApiEndpoint.post("uploadMaterial", "/materials/upload")
  .setPayload(UploadMaterialPayload)
  .addSuccess(Material);
export const families = HttpApiEndpoint.get("families", "/families").addSuccess(
  S.Array(Family),
);
export const inviteFamily = HttpApiEndpoint.post(
  "inviteFamily",
  "/families/:familyId/invite",
)
  .setPath(params("familyId"))
  .setPayload(InviteFamilyPayload)
  .addSuccess(SuccessResponse);
export const qrInvite = HttpApiEndpoint.post(
  "qrInvite",
  "/families/:familyId/qr-invite",
)
  .setPath(params("familyId"))
  .setPayload(QrInvitePayload)
  .addSuccess(QrInviteResponse);
export const createLesson = HttpApiEndpoint.post("createLesson", "/lessons")
  .setPayload(CreateLessonPayload)
  .addSuccess(Lesson);
export const updateLesson = HttpApiEndpoint.patch("updateLesson", "/lessons/:id")
  .setPath(params("id"))
  .setPayload(UpdateLessonPayload)
  .addSuccess(Lesson);
export const lessons = HttpApiEndpoint.get("lessons", "/lessons")
  .setUrlParams(AdminLessonsQuery)
  .addSuccess(S.Array(Lesson));
export const saveLessonNote = HttpApiEndpoint.post("saveLessonNote", "/lessons/:id/notes")
  .setPath(params("id"))
  .setPayload(SaveLessonNotePayload)
  .addSuccess(LessonNote);
export const lessonNote = HttpApiEndpoint.get("lessonNote", "/lessons/:id/notes")
  .setPath(params("id"))
  .addSuccess(LessonNote);
export const publishLessonNote = HttpApiEndpoint.patch(
  "publishLessonNote",
  "/lessons/:id/notes/publish",
)
  .setPath(params("id"))
  .addSuccess(LessonNote);
export const gcalStatus = HttpApiEndpoint.get("gcalStatus", "/gcal/status").addSuccess(
  GcalStatus,
);
export const gcalDisconnect = HttpApiEndpoint.post(
  "gcalDisconnect",
  "/gcal/disconnect",
).addSuccess(SuccessResponse);
export const workingHours = HttpApiEndpoint.get("workingHours", "/working-hours").addSuccess(
  WorkingHours,
);
export const saveWorkingHours = HttpApiEndpoint.post(
  "saveWorkingHours",
  "/working-hours",
)
  .setPayload(WorkingHours)
  .addSuccess(SuccessResponse);
export const saveTestimonialReminderInterval = HttpApiEndpoint.post(
  "saveTestimonialReminderInterval",
  "/testimonial-reminder-interval",
)
  .setPayload(SaveReminderIntervalPayload)
  .addSuccess(ReminderIntervalResponse);
export const updateTestimonialApproval = HttpApiEndpoint.patch(
  "updateTestimonialApproval",
  "/testimonials/:id",
)
  .setPath(params("id"))
  .setPayload(UpdateTestimonialApprovalPayload)
  .addSuccess(SuccessResponse);

export type AdminClientEndpoint =
  | typeof submissions
  | typeof updateSubmission
  | typeof students
  | typeof student
  | typeof adminCourses
  | typeof courseStudents
  | typeof createCourse
  | typeof updateCourse
  | typeof deleteCourse
  | typeof createModule
  | typeof updateModule
  | typeof deleteModule
  | typeof enrollStudent
  | typeof unenrollStudent
  | typeof assignMaterial
  | typeof unassignMaterial
  | typeof deleteMaterial
  | typeof uploadMaterial
  | typeof families
  | typeof inviteFamily
  | typeof qrInvite
  | typeof createLesson
  | typeof updateLesson
  | typeof lessons
  | typeof saveLessonNote
  | typeof lessonNote
  | typeof publishLessonNote
  | typeof gcalStatus
  | typeof gcalDisconnect
  | typeof workingHours
  | typeof saveWorkingHours
  | typeof saveTestimonialReminderInterval
  | typeof updateTestimonialApproval;

export const adminClientGroup = HttpApiGroup.make("admin")
  .addError(ApiError, { status: 400 })
  .addError(ApiError, { status: 401 })
  .addError(ApiError, { status: 403 })
  .addError(ApiError, { status: 404 })
  .addError(ApiError, { status: 409 })
  .addError(ApiError, { status: 500 })
  .add(submissions)
  .add(updateSubmission)
  .add(students)
  .add(student)
  .add(adminCourses)
  .add(courseStudents)
  .add(createCourse)
  .add(updateCourse)
  .add(deleteCourse)
  .add(createModule)
  .add(updateModule)
  .add(deleteModule)
  .add(enrollStudent)
  .add(unenrollStudent)
  .add(assignMaterial)
  .add(unassignMaterial)
  .add(deleteMaterial)
  .add(uploadMaterial)
  .add(families)
  .add(inviteFamily)
  .add(qrInvite)
  .add(createLesson)
  .add(updateLesson)
  .add(lessons)
  .add(saveLessonNote)
  .add(lessonNote)
  .add(publishLessonNote)
  .add(gcalStatus)
  .add(gcalDisconnect)
  .add(workingHours)
  .add(saveWorkingHours)
  .add(saveTestimonialReminderInterval)
  .add(updateTestimonialApproval)
  .prefix("/api/admin");

export const clientApi = HttpApi.make("dfg")
  .add(publicGroup)
  .add(authGroup)
  .add(authenticatedClientGroup)
  .add(adminClientGroup);
