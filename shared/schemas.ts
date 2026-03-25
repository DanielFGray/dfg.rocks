export type UserRole = "admin" | "student" | "parent" | "teacher";

export type User = {
  id: string;
  username: string;
  name: string;
  email: string;
  role: UserRole;
  is_verified: boolean;
};

export type Course = {
  id: string;
  title: string;
  description: string;
  instrument: string;
};

export type Module = {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  sort_order: number;
};

export type Material = {
  id: string;
  title: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  is_global: boolean;
};

export type CourseDetail = Course & {
  modules: (Module & { materials: Material[] })[];
};

export type StudentDetail = User & {
  enrolled_courses: { id: string; title: string; instrument: string }[];
  assigned_materials: Material[];
};

export type Submission = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  instrument: string;
  format: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

export type PracticeLog = {
  id: string;
  student_id: string;
  material_id: string;
  status: "practiced" | "completed";
  notes: string | null;
  logged_at: string;
};

export type AssignmentNote = {
  id: string;
  student_id: string;
  material_id: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  is_read: boolean;
  created_at: string;
};

export type Family = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: string;
};

export type FamilyInvitation = {
  id: string;
  family_id: string;
  family_name: string;
  code: string | null;
  user_id: string | null;
  email: string | null;
};

export type LocationType =
  | "in_person_teacher_travels"
  | "in_person_student_travels"
  | "studio"
  | "online";

export type LessonStatus = "scheduled" | "completed" | "cancelled" | "no_show";

export type DepositStatus = "held" | "refunded" | "captured";

export type Lesson = {
  id: string;
  student_id: string;
  gcal_event_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  location_type: LocationType;
  status: LessonStatus;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type StudentRate = {
  id: string;
  student_id: string;
  rate_cents: number;
  lesson_duration_minutes: number;
  location_type: LocationType;
  notes: string | null;
  created_at: string;
};

export type LessonDeposit = {
  id: string;
  lesson_id: string;
  amount_cents: number;
  status: DepositStatus;
  created_at: string;
};

export type UserEmail = {
  id: string;
  email: string;
  is_verified: boolean;
  is_primary: boolean;
  created_at: string;
};

export type LessonNote = {
  id: string;
  lesson_id: string;
  topics_covered: string | null;
  homework: string | null;
  progress_observations: string | null;
  notes: string | null;
  material_ids: string[] | null;
  draft: boolean;
  created_at: string;
  updated_at: string;
};

export type TimeSlot = {
  start: string;
  end: string;
};

export type WorkingHoursDay = {
  start: string;
  end: string;
};

export type WorkingHours = {
  0: WorkingHoursDay | null;
  1: WorkingHoursDay | null;
  2: WorkingHoursDay | null;
  3: WorkingHoursDay | null;
  4: WorkingHoursDay | null;
  5: WorkingHoursDay | null;
  6: WorkingHoursDay | null;
};

export type GcalStatus = {
  connected: boolean;
  calendar_id: string | null;
};
