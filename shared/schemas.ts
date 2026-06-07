import * as S from "effect/Schema";

export const UserRole = S.Union(
  S.Literal("admin"),
  S.Literal("student"),
  S.Literal("parent"),
  S.Literal("teacher"),
);

export type UserRole = S.Schema.Type<typeof UserRole>;

export const User = S.Struct({
  id: S.String,
  username: S.String,
  name: S.String,
  email: S.String,
  role: UserRole,
  is_verified: S.Boolean,
});

export type User = S.Schema.Type<typeof User>;

export const Course = S.Struct({
  id: S.String,
  title: S.String,
  description: S.String,
  instrument: S.String,
});

export type Course = S.Schema.Type<typeof Course>;

export const Module = S.Struct({
  id: S.String,
  course_id: S.String,
  title: S.String,
  content: S.NullishOr(S.Unknown),
  sort_order: S.Number,
});

export type Module = S.Schema.Type<typeof Module>;

export const MaterialNotationTrack = S.Struct({
  index: S.Number,
  name: S.String,
  short_name: S.String,
  is_percussion: S.Boolean,
});

export const Material = S.Struct({
  id: S.String,
  title: S.String,
  original_filename: S.String,
  mime_type: S.String,
  file_size: S.Number,
  is_global: S.Boolean,
  notation_tracks: S.NullishOr(S.Array(MaterialNotationTrack)),
});

export type Material = S.Schema.Type<typeof Material>;

export type MaterialNotationTrack = NonNullable<
  Material["notation_tracks"]
>[number];

export const AssignedMaterial = S.Struct({
  id: S.String,
  title: S.String,
  original_filename: S.String,
  mime_type: S.String,
  file_size: S.Number,
  is_global: S.Boolean,
  notation_tracks: S.NullishOr(S.Array(MaterialNotationTrack)),
  assigned_track_index: S.NullishOr(S.Number),
});

export type AssignedMaterial = S.Schema.Type<typeof AssignedMaterial>;

export const ModuleWithMaterials = S.Struct({
  id: S.String,
  course_id: S.String,
  title: S.String,
  content: S.NullishOr(S.Unknown),
  sort_order: S.Number,
  materials: S.Array(Material),
});

export type ModuleWithMaterials = S.Schema.Type<typeof ModuleWithMaterials>;

export const CourseDetail = S.Struct({
  id: S.String,
  title: S.String,
  description: S.String,
  instrument: S.String,
  modules: S.Array(ModuleWithMaterials),
});

export type CourseDetail = S.Schema.Type<typeof CourseDetail>;

export const EnrolledCourse = S.Struct({
  id: S.String,
  title: S.String,
  instrument: S.String,
});

export type EnrolledCourse = S.Schema.Type<typeof EnrolledCourse>;

export const StudentDetail = S.Struct({
  id: S.String,
  username: S.String,
  name: S.String,
  email: S.String,
  role: UserRole,
  is_verified: S.Boolean,
  enrolled_courses: S.Array(EnrolledCourse),
  assigned_materials: S.Array(AssignedMaterial),
});

export type StudentDetail = S.Schema.Type<typeof StudentDetail>;

export const Submission = S.Struct({
  id: S.String,
  name: S.String,
  email: S.String,
  phone: S.NullishOr(S.String),
  instrument: S.String,
  format: S.String,
  message: S.String,
  is_read: S.Boolean,
  created_at: S.String,
});

export type Submission = S.Schema.Type<typeof Submission>;

export const PracticeLogStatus = S.Union(
  S.Literal("practiced"),
  S.Literal("completed"),
);

export type PracticeLogStatus = S.Schema.Type<typeof PracticeLogStatus>;

export const PracticeLog = S.Struct({
  id: S.String,
  student_id: S.String,
  material_id: S.String,
  status: PracticeLogStatus,
  notes: S.NullishOr(S.String),
  logged_at: S.String,
});

export type PracticeLog = S.Schema.Type<typeof PracticeLog>;

export const AssignmentProgress = S.Struct({
  material_id: S.String,
  listened_seconds: S.Number,
  updated_at: S.String,
});

export type AssignmentProgress = S.Schema.Type<typeof AssignmentProgress>;

export const AssignmentNote = S.Struct({
  id: S.String,
  student_id: S.String,
  material_id: S.String,
  body: S.String,
  created_at: S.String,
  updated_at: S.String,
});

export type AssignmentNote = S.Schema.Type<typeof AssignmentNote>;

export const AssignmentReview = S.Struct({
  id: S.String,
  material_id: S.String,
  stars: S.Number.pipe(S.between(1, 5)),
  listened_seconds: S.Number,
  created_at: S.String,
});

export type AssignmentReview = S.Schema.Type<typeof AssignmentReview>;

export const Message = S.Struct({
  id: S.String,
  sender_id: S.String,
  recipient_id: S.String,
  body: S.String,
  is_read: S.Boolean,
  created_at: S.String,
});

export type Message = S.Schema.Type<typeof Message>;

export const Family = S.Struct({
  id: S.String,
  slug: S.String,
  name: S.String,
  description: S.NullishOr(S.String),
  created_at: S.String,
});

export type Family = S.Schema.Type<typeof Family>;

export const FamilyInvitation = S.Struct({
  id: S.String,
  family_id: S.String,
  family_name: S.String,
  code: S.NullishOr(S.String),
  user_id: S.NullishOr(S.String),
  email: S.NullishOr(S.String),
});

export type FamilyInvitation = S.Schema.Type<typeof FamilyInvitation>;

export const LocationType = S.Union(
  S.Literal("in_person_teacher_travels"),
  S.Literal("in_person_student_travels"),
  S.Literal("studio"),
  S.Literal("online"),
);

export type LocationType = S.Schema.Type<typeof LocationType>;

export const LessonStatus = S.Union(
  S.Literal("scheduled"),
  S.Literal("completed"),
  S.Literal("cancelled"),
  S.Literal("no_show"),
);

export type LessonStatus = S.Schema.Type<typeof LessonStatus>;

export const DepositStatus = S.Union(
  S.Literal("held"),
  S.Literal("refunded"),
  S.Literal("captured"),
);

export type DepositStatus = S.Schema.Type<typeof DepositStatus>;

export const Lesson = S.Struct({
  id: S.String,
  student_id: S.String,
  gcal_event_id: S.NullishOr(S.String),
  scheduled_at: S.String,
  duration_minutes: S.Number,
  location_type: LocationType,
  status: LessonStatus,
  cancellation_reason: S.NullishOr(S.String),
  cancelled_at: S.NullishOr(S.String),
  completed_at: S.NullishOr(S.String),
  created_at: S.String,
});

export type Lesson = S.Schema.Type<typeof Lesson>;

export const StudentRate = S.Struct({
  id: S.String,
  student_id: S.String,
  rate_cents: S.Number,
  lesson_duration_minutes: S.Number,
  location_type: LocationType,
  notes: S.NullishOr(S.String),
  created_at: S.String,
});

export type StudentRate = S.Schema.Type<typeof StudentRate>;

export const LessonDeposit = S.Struct({
  id: S.String,
  lesson_id: S.String,
  amount_cents: S.Number,
  status: DepositStatus,
  created_at: S.String,
});

export type LessonDeposit = S.Schema.Type<typeof LessonDeposit>;

export const UserEmail = S.Struct({
  id: S.String,
  email: S.String,
  is_verified: S.Boolean,
  is_primary: S.Boolean,
  created_at: S.String,
});

export type UserEmail = S.Schema.Type<typeof UserEmail>;

export const LessonNote = S.Struct({
  id: S.String,
  lesson_id: S.String,
  topics_covered: S.NullishOr(S.String),
  homework: S.NullishOr(S.String),
  progress_observations: S.NullishOr(S.String),
  notes: S.NullishOr(S.String),
  material_ids: S.NullishOr(S.Array(S.String)),
  draft: S.Boolean,
  created_at: S.String,
  updated_at: S.String,
});

export type LessonNote = S.Schema.Type<typeof LessonNote>;

export const TimeSlot = S.Struct({
  start: S.String,
  end: S.String,
});

export type TimeSlot = S.Schema.Type<typeof TimeSlot>;

export const WorkingHoursDay = S.Struct({
  start: S.String,
  end: S.String,
});

export type WorkingHoursDay = S.Schema.Type<typeof WorkingHoursDay>;

export const WorkingHours = S.Struct({
  0: S.NullishOr(WorkingHoursDay),
  1: S.NullishOr(WorkingHoursDay),
  2: S.NullishOr(WorkingHoursDay),
  3: S.NullishOr(WorkingHoursDay),
  4: S.NullishOr(WorkingHoursDay),
  5: S.NullishOr(WorkingHoursDay),
  6: S.NullishOr(WorkingHoursDay),
});

export type WorkingHours = S.Schema.Type<typeof WorkingHours>;

export const GcalStatus = S.Struct({
  connected: S.Boolean,
  calendar_id: S.NullishOr(S.String),
});

export type GcalStatus = S.Schema.Type<typeof GcalStatus>;

export const Testimonial = S.Struct({
  id: S.String,
  user_id: S.String,
  body: S.String,
  display_name: S.String,
  role_label: S.String,
  is_approved: S.Boolean,
  created_at: S.String,
  updated_at: S.String,
});

export type Testimonial = S.Schema.Type<typeof Testimonial>;

export const TokenSearch = S.Struct({
  token: S.optional(S.String),
});

export type TokenSearch = S.Schema.Type<typeof TokenSearch>;

export const InviteSearch = S.Struct({
  id: S.optional(S.String),
  code: S.optional(S.String),
});

export type InviteSearch = S.Schema.Type<typeof InviteSearch>;

export const ApiError = S.Struct({
  error: S.String,
  status: S.optional(S.Number),
});

export type ApiError = S.Schema.Type<typeof ApiError>;
