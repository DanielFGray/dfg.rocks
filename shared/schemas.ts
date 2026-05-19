import * as v from "valibot";

export const UserRole = v.picklist(["admin", "student", "parent", "teacher"]);

export type UserRole = v.InferOutput<typeof UserRole>;

export const User = v.object({
  id: v.string(),
  username: v.string(),
  name: v.string(),
  email: v.string(),
  role: UserRole,
  is_verified: v.boolean(),
});

export type User = v.InferOutput<typeof User>;

export const Course = v.object({
  id: v.string(),
  title: v.string(),
  description: v.string(),
  instrument: v.string(),
});

export type Course = v.InferOutput<typeof Course>;

export const Module = v.object({
  id: v.string(),
  course_id: v.string(),
  title: v.string(),
  content: v.nullable(v.unknown()),
  sort_order: v.number(),
});

export type Module = v.InferOutput<typeof Module>;

export const MaterialNotationTrack = v.object({
  index: v.number(),
  name: v.string(),
  short_name: v.string(),
  is_percussion: v.boolean(),
});

export const Material = v.object({
  id: v.string(),
  title: v.string(),
  original_filename: v.string(),
  mime_type: v.string(),
  file_size: v.number(),
  is_global: v.boolean(),
  notation_tracks: v.nullable(v.array(MaterialNotationTrack)),
});

export type Material = v.InferOutput<typeof Material>;

export type MaterialNotationTrack = NonNullable<Material["notation_tracks"]>[number];

export const AssignedMaterial = v.object({
  id: v.string(),
  title: v.string(),
  original_filename: v.string(),
  mime_type: v.string(),
  file_size: v.number(),
  is_global: v.boolean(),
  notation_tracks: v.nullable(v.array(MaterialNotationTrack)),
  assigned_track_index: v.nullable(v.number()),
});

export type AssignedMaterial = v.InferOutput<typeof AssignedMaterial>;

export const ModuleWithMaterials = v.object({
  id: v.string(),
  course_id: v.string(),
  title: v.string(),
  content: v.nullable(v.unknown()),
  sort_order: v.number(),
  materials: v.array(Material),
});

export type ModuleWithMaterials = v.InferOutput<typeof ModuleWithMaterials>;

export const CourseDetail = v.object({
  id: v.string(),
  title: v.string(),
  description: v.string(),
  instrument: v.string(),
  modules: v.array(ModuleWithMaterials),
});

export type CourseDetail = v.InferOutput<typeof CourseDetail>;

export const EnrolledCourse = v.object({
  id: v.string(),
  title: v.string(),
  instrument: v.string(),
});

export type EnrolledCourse = v.InferOutput<typeof EnrolledCourse>;

export const StudentDetail = v.object({
  id: v.string(),
  username: v.string(),
  name: v.string(),
  email: v.string(),
  role: UserRole,
  is_verified: v.boolean(),
  enrolled_courses: v.array(EnrolledCourse),
  assigned_materials: v.array(AssignedMaterial),
});

export type StudentDetail = v.InferOutput<typeof StudentDetail>;

export const Submission = v.object({
  id: v.string(),
  name: v.string(),
  email: v.string(),
  phone: v.nullable(v.string()),
  instrument: v.string(),
  format: v.string(),
  message: v.string(),
  is_read: v.boolean(),
  created_at: v.string(),
});

export type Submission = v.InferOutput<typeof Submission>;

export const PracticeLogStatus = v.picklist(["practiced", "completed"]);

export type PracticeLogStatus = v.InferOutput<typeof PracticeLogStatus>;

export const PracticeLog = v.object({
  id: v.string(),
  student_id: v.string(),
  material_id: v.string(),
  status: PracticeLogStatus,
  notes: v.nullable(v.string()),
  logged_at: v.string(),
});

export type PracticeLog = v.InferOutput<typeof PracticeLog>;

export const AssignmentProgress = v.object({
  material_id: v.string(),
  listened_seconds: v.number(),
  updated_at: v.string(),
});

export type AssignmentProgress = v.InferOutput<typeof AssignmentProgress>;

export const AssignmentNote = v.object({
  id: v.string(),
  student_id: v.string(),
  material_id: v.string(),
  body: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
});

export type AssignmentNote = v.InferOutput<typeof AssignmentNote>;

export const AssignmentReview = v.object({
  id: v.string(),
  material_id: v.string(),
  stars: v.pipe(v.number(), v.minValue(1), v.maxValue(5)),
  listened_seconds: v.number(),
  created_at: v.string(),
});

export type AssignmentReview = v.InferOutput<typeof AssignmentReview>;

export const Message = v.object({
  id: v.string(),
  sender_id: v.string(),
  recipient_id: v.string(),
  body: v.string(),
  is_read: v.boolean(),
  created_at: v.string(),
});

export type Message = v.InferOutput<typeof Message>;

export const Family = v.object({
  id: v.string(),
  slug: v.string(),
  name: v.string(),
  description: v.nullable(v.string()),
  created_at: v.string(),
});

export type Family = v.InferOutput<typeof Family>;

export const FamilyInvitation = v.object({
  id: v.string(),
  family_id: v.string(),
  family_name: v.string(),
  code: v.nullable(v.string()),
  user_id: v.nullable(v.string()),
  email: v.nullable(v.string()),
});

export type FamilyInvitation = v.InferOutput<typeof FamilyInvitation>;

export const LocationType = v.picklist([
  "in_person_teacher_travels",
  "in_person_student_travels",
  "studio",
  "online",
]);

export type LocationType = v.InferOutput<typeof LocationType>;

export const LessonStatus = v.picklist(["scheduled", "completed", "cancelled", "no_show"]);

export type LessonStatus = v.InferOutput<typeof LessonStatus>;

export const DepositStatus = v.picklist(["held", "refunded", "captured"]);

export type DepositStatus = v.InferOutput<typeof DepositStatus>;

export const Lesson = v.object({
  id: v.string(),
  student_id: v.string(),
  gcal_event_id: v.nullable(v.string()),
  scheduled_at: v.string(),
  duration_minutes: v.number(),
  location_type: LocationType,
  status: LessonStatus,
  cancellation_reason: v.nullable(v.string()),
  cancelled_at: v.nullable(v.string()),
  completed_at: v.nullable(v.string()),
  created_at: v.string(),
});

export type Lesson = v.InferOutput<typeof Lesson>;

export const StudentRate = v.object({
  id: v.string(),
  student_id: v.string(),
  rate_cents: v.number(),
  lesson_duration_minutes: v.number(),
  location_type: LocationType,
  notes: v.nullable(v.string()),
  created_at: v.string(),
});

export type StudentRate = v.InferOutput<typeof StudentRate>;

export const LessonDeposit = v.object({
  id: v.string(),
  lesson_id: v.string(),
  amount_cents: v.number(),
  status: DepositStatus,
  created_at: v.string(),
});

export type LessonDeposit = v.InferOutput<typeof LessonDeposit>;

export const UserEmail = v.object({
  id: v.string(),
  email: v.string(),
  is_verified: v.boolean(),
  is_primary: v.boolean(),
  created_at: v.string(),
});

export type UserEmail = v.InferOutput<typeof UserEmail>;

export const LessonNote = v.object({
  id: v.string(),
  lesson_id: v.string(),
  topics_covered: v.nullable(v.string()),
  homework: v.nullable(v.string()),
  progress_observations: v.nullable(v.string()),
  notes: v.nullable(v.string()),
  material_ids: v.nullable(v.array(v.string())),
  draft: v.boolean(),
  created_at: v.string(),
  updated_at: v.string(),
});

export type LessonNote = v.InferOutput<typeof LessonNote>;

export const TimeSlot = v.object({
  start: v.string(),
  end: v.string(),
});

export type TimeSlot = v.InferOutput<typeof TimeSlot>;

export const WorkingHoursDay = v.object({
  start: v.string(),
  end: v.string(),
});

export type WorkingHoursDay = v.InferOutput<typeof WorkingHoursDay>;

export const WorkingHours = v.object({
  0: v.nullable(WorkingHoursDay),
  1: v.nullable(WorkingHoursDay),
  2: v.nullable(WorkingHoursDay),
  3: v.nullable(WorkingHoursDay),
  4: v.nullable(WorkingHoursDay),
  5: v.nullable(WorkingHoursDay),
  6: v.nullable(WorkingHoursDay),
});

export type WorkingHours = v.InferOutput<typeof WorkingHours>;

export const GcalStatus = v.object({
  connected: v.boolean(),
  calendar_id: v.nullable(v.string()),
});

export type GcalStatus = v.InferOutput<typeof GcalStatus>;

export const Testimonial = v.object({
  id: v.string(),
  user_id: v.string(),
  body: v.string(),
  display_name: v.string(),
  role_label: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
});

export type Testimonial = v.InferOutput<typeof Testimonial>;
