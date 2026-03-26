import * as v from "valibot";

export const UserRoleSchema = v.picklist([
  "admin",
  "student",
  "parent",
  "teacher",
]);

export type UserRole = v.InferOutput<typeof UserRoleSchema>;

export const UserSchema = v.object({
  id: v.string(),
  username: v.string(),
  name: v.string(),
  email: v.string(),
  role: UserRoleSchema,
  is_verified: v.boolean(),
});

export type User = v.InferOutput<typeof UserSchema>;

export const CourseSchema = v.object({
  id: v.string(),
  title: v.string(),
  description: v.string(),
  instrument: v.string(),
});

export type Course = v.InferOutput<typeof CourseSchema>;

export const ModuleSchema = v.object({
  id: v.string(),
  course_id: v.string(),
  title: v.string(),
  description: v.nullable(v.string()),
  sort_order: v.number(),
});

export type Module = v.InferOutput<typeof ModuleSchema>;

export const MaterialSchema = v.object({
  id: v.string(),
  title: v.string(),
  original_filename: v.string(),
  mime_type: v.string(),
  file_size: v.number(),
  is_global: v.boolean(),
});

export type Material = v.InferOutput<typeof MaterialSchema>;

export const ModuleWithMaterialsSchema = v.object({
  id: v.string(),
  course_id: v.string(),
  title: v.string(),
  description: v.nullable(v.string()),
  sort_order: v.number(),
  materials: v.array(MaterialSchema),
});

export type ModuleWithMaterials = v.InferOutput<typeof ModuleWithMaterialsSchema>;

export const CourseDetailSchema = v.object({
  id: v.string(),
  title: v.string(),
  description: v.string(),
  instrument: v.string(),
  modules: v.array(ModuleWithMaterialsSchema),
});

export type CourseDetail = v.InferOutput<typeof CourseDetailSchema>;

export const EnrolledCourseSchema = v.object({
  id: v.string(),
  title: v.string(),
  instrument: v.string(),
});

export type EnrolledCourse = v.InferOutput<typeof EnrolledCourseSchema>;

export const StudentDetailSchema = v.object({
  id: v.string(),
  username: v.string(),
  name: v.string(),
  email: v.string(),
  role: UserRoleSchema,
  is_verified: v.boolean(),
  enrolled_courses: v.array(EnrolledCourseSchema),
  assigned_materials: v.array(MaterialSchema),
});

export type StudentDetail = v.InferOutput<typeof StudentDetailSchema>;

export const SubmissionSchema = v.object({
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

export type Submission = v.InferOutput<typeof SubmissionSchema>;

export const PracticeLogStatusSchema = v.picklist(["practiced", "completed"]);

export type PracticeLogStatus = v.InferOutput<typeof PracticeLogStatusSchema>;

export const PracticeLogSchema = v.object({
  id: v.string(),
  student_id: v.string(),
  material_id: v.string(),
  status: PracticeLogStatusSchema,
  notes: v.nullable(v.string()),
  logged_at: v.string(),
});

export type PracticeLog = v.InferOutput<typeof PracticeLogSchema>;

export const AssignmentNoteSchema = v.object({
  id: v.string(),
  student_id: v.string(),
  material_id: v.string(),
  body: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
});

export type AssignmentNote = v.InferOutput<typeof AssignmentNoteSchema>;

export const MessageSchema = v.object({
  id: v.string(),
  sender_id: v.string(),
  recipient_id: v.string(),
  body: v.string(),
  is_read: v.boolean(),
  created_at: v.string(),
});

export type Message = v.InferOutput<typeof MessageSchema>;

export const FamilySchema = v.object({
  id: v.string(),
  slug: v.string(),
  name: v.string(),
  description: v.nullable(v.string()),
  created_at: v.string(),
});

export type Family = v.InferOutput<typeof FamilySchema>;

export const FamilyInvitationSchema = v.object({
  id: v.string(),
  family_id: v.string(),
  family_name: v.string(),
  code: v.nullable(v.string()),
  user_id: v.nullable(v.string()),
  email: v.nullable(v.string()),
});

export type FamilyInvitation = v.InferOutput<typeof FamilyInvitationSchema>;

export const LocationTypeSchema = v.picklist([
  "in_person_teacher_travels",
  "in_person_student_travels",
  "studio",
  "online",
]);

export type LocationType = v.InferOutput<typeof LocationTypeSchema>;

export const LessonStatusSchema = v.picklist([
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
]);

export type LessonStatus = v.InferOutput<typeof LessonStatusSchema>;

export const DepositStatusSchema = v.picklist([
  "held",
  "refunded",
  "captured",
]);

export type DepositStatus = v.InferOutput<typeof DepositStatusSchema>;

export const LessonSchema = v.object({
  id: v.string(),
  student_id: v.string(),
  gcal_event_id: v.nullable(v.string()),
  scheduled_at: v.string(),
  duration_minutes: v.number(),
  location_type: LocationTypeSchema,
  status: LessonStatusSchema,
  cancellation_reason: v.nullable(v.string()),
  cancelled_at: v.nullable(v.string()),
  completed_at: v.nullable(v.string()),
  created_at: v.string(),
});

export type Lesson = v.InferOutput<typeof LessonSchema>;

export const StudentRateSchema = v.object({
  id: v.string(),
  student_id: v.string(),
  rate_cents: v.number(),
  lesson_duration_minutes: v.number(),
  location_type: LocationTypeSchema,
  notes: v.nullable(v.string()),
  created_at: v.string(),
});

export type StudentRate = v.InferOutput<typeof StudentRateSchema>;

export const LessonDepositSchema = v.object({
  id: v.string(),
  lesson_id: v.string(),
  amount_cents: v.number(),
  status: DepositStatusSchema,
  created_at: v.string(),
});

export type LessonDeposit = v.InferOutput<typeof LessonDepositSchema>;

export const UserEmailSchema = v.object({
  id: v.string(),
  email: v.string(),
  is_verified: v.boolean(),
  is_primary: v.boolean(),
  created_at: v.string(),
});

export type UserEmail = v.InferOutput<typeof UserEmailSchema>;

export const LessonNoteSchema = v.object({
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

export type LessonNote = v.InferOutput<typeof LessonNoteSchema>;

export const TimeSlotSchema = v.object({
  start: v.string(),
  end: v.string(),
});

export type TimeSlot = v.InferOutput<typeof TimeSlotSchema>;

export const WorkingHoursDaySchema = v.object({
  start: v.string(),
  end: v.string(),
});

export type WorkingHoursDay = v.InferOutput<typeof WorkingHoursDaySchema>;

export const WorkingHoursSchema = v.object({
  0: v.nullable(WorkingHoursDaySchema),
  1: v.nullable(WorkingHoursDaySchema),
  2: v.nullable(WorkingHoursDaySchema),
  3: v.nullable(WorkingHoursDaySchema),
  4: v.nullable(WorkingHoursDaySchema),
  5: v.nullable(WorkingHoursDaySchema),
  6: v.nullable(WorkingHoursDaySchema),
});

export type WorkingHours = v.InferOutput<typeof WorkingHoursSchema>;

export const GcalStatusSchema = v.object({
  connected: v.boolean(),
  calendar_id: v.nullable(v.string()),
});

export type GcalStatus = v.InferOutput<typeof GcalStatusSchema>;
