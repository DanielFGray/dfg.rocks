import * as S from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

// Query strings and form fields carry booleans as "true" / "false".
export const BooleanFromString = S.Literals(["true", "false"]).pipe(
  S.decodeTo(
    S.Boolean,
    SchemaTransformation.transform({
      decode: (literal) => literal === "true",
      encode: (bool) => (bool ? "true" : "false"),
    }),
  ),
);

/** Attribute values the module editor's nodes and marks use (heading level, link href, material id). */
const RichTextAttrs = S.Record(S.String, S.NullOr(S.Union([S.String, S.Number, S.Boolean])));

export const RichTextMark = S.Struct({
  type: S.String,
  attrs: S.optional(RichTextAttrs),
});

export type RichTextMark = S.Schema.Type<typeof RichTextMark>;

/**
 * One node of a TipTap (ProseMirror) document, as `editor.getJSON()` produces it.
 * Arrays are mutable because TipTap's `JSONContent`, which the editor accepts,
 * declares them so.
 */
export interface RichTextNode {
  readonly type: string;
  readonly attrs?: S.Schema.Type<typeof RichTextAttrs> | undefined;
  readonly content?: Array<RichTextNode> | undefined;
  readonly marks?: Array<RichTextMark> | undefined;
  readonly text?: string | undefined;
}

export const RichTextNode: S.Codec<RichTextNode> = S.Struct({
  type: S.String,
  attrs: S.optional(RichTextAttrs),
  content: S.optional(S.mutable(S.Array(S.suspend(() => RichTextNode)))),
  marks: S.optional(S.mutable(S.Array(RichTextMark))),
  text: S.optional(S.String),
});

/** Module content: the root node of a module editor document. */
export const RichTextDocument = S.Struct({
  type: S.Literal("doc"),
  content: S.optional(S.mutable(S.Array(RichTextNode))),
});

export type RichTextDocument = S.Schema.Type<typeof RichTextDocument>;

export const UserRole = S.Union([
  S.Literal("admin"),
  S.Literal("student"),
  S.Literal("parent"),
  S.Literal("teacher"),
]);

export type UserRole = S.Schema.Type<typeof UserRole>;

export const FamilyInviteRole = S.Literals(["parent", "student"]);

export type FamilyInviteRole = S.Schema.Type<typeof FamilyInviteRole>;

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
  content: S.NullishOr(RichTextDocument),
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

export type MaterialNotationTrack = NonNullable<Material["notation_tracks"]>[number];

export const AssignedMaterial = S.Struct({
  id: S.String,
  title: S.String,
  original_filename: S.String,
  mime_type: S.String,
  file_size: S.Number,
  is_global: S.Boolean,
  notation_tracks: S.NullishOr(S.Array(MaterialNotationTrack)),
  assigned_track_index: S.NullishOr(S.Number),
  listened_seconds: S.optional(S.Number),
});

export type AssignedMaterial = S.Schema.Type<typeof AssignedMaterial>;

export const ModuleWithMaterials = S.Struct({
  id: S.String,
  course_id: S.String,
  title: S.String,
  content: S.NullishOr(RichTextDocument),
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
  ip_address: S.NullishOr(S.String),
  location_country: S.NullishOr(S.String),
  location_region: S.NullishOr(S.String),
  location_city: S.NullishOr(S.String),
});

export type Submission = S.Schema.Type<typeof Submission>;

export const PracticeLog = S.Struct({
  id: S.String,
  student_id: S.String,
  material_id: S.String,
  rating: S.NullishOr(S.Number.pipe(S.check(S.isBetween({ minimum: 1, maximum: 5 })))),
  duration_minutes: S.NullishOr(S.Number),
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
  stars: S.Number.pipe(S.check(S.isBetween({ minimum: 1, maximum: 5 }))),
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
  invited_role: S.NullishOr(FamilyInviteRole),
});

export type FamilyInvitation = S.Schema.Type<typeof FamilyInvitation>;

export const LocationType = S.Union([
  S.Literal("in_person_teacher_travels"),
  S.Literal("in_person_student_travels"),
  S.Literal("studio"),
  S.Literal("online"),
]);

export type LocationType = S.Schema.Type<typeof LocationType>;

export const LessonStatus = S.Union([
  S.Literal("scheduled"),
  S.Literal("completed"),
  S.Literal("cancelled"),
  S.Literal("no_show"),
]);

export type LessonStatus = S.Schema.Type<typeof LessonStatus>;

export const DepositStatus = S.Union([
  S.Literal("held"),
  S.Literal("refunded"),
  S.Literal("captured"),
]);

export type DepositStatus = S.Schema.Type<typeof DepositStatus>;

export const BillingModel = S.Literals(["single_booking", "monthly_prepaid"]);

export type BillingModel = S.Schema.Type<typeof BillingModel>;

export const DepositPolicyOutcome = S.Union([
  S.Literal("none"),
  S.Literal("refunded"),
  S.Literal("captured"),
]);

export type DepositPolicyOutcome = S.Schema.Type<typeof DepositPolicyOutcome>;

export const FeePolicyOutcome = S.Literals(["none", "recorded"]);

export type FeePolicyOutcome = S.Schema.Type<typeof FeePolicyOutcome>;

export const LessonCancellationPolicy = S.Struct({
  billing_model: BillingModel,
  hours_until_lesson: S.Number,
  is_late: S.Boolean,
  deposit_outcome: DepositPolicyOutcome,
  fee_outcome: FeePolicyOutcome,
  amount_cents: S.Number,
});

export type LessonCancellationPolicy = S.Schema.Type<typeof LessonCancellationPolicy>;

export const CancellationPolicySettings = S.Struct({
  cancellation_window_hours: S.Number,
  late_cancel_charge_percent: S.Number,
});

export type CancellationPolicySettings = S.Schema.Type<typeof CancellationPolicySettings>;

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
  cancellation_fee_cents: S.Number,
  remainder_due_cents: S.Number,
  recurring_schedule_id: S.NullishOr(S.String),
  recurrence_date: S.NullishOr(S.String),
  created_at: S.String,
});

export type Lesson = S.Schema.Type<typeof Lesson>;

export const StudentRate = S.Struct({
  id: S.String,
  student_id: S.String,
  rate_cents: S.Number,
  lesson_duration_minutes: S.Number,
  location_type: LocationType,
  billing_model: BillingModel,
  notes: S.NullishOr(S.String),
  created_at: S.String,
});

export type StudentRate = S.Schema.Type<typeof StudentRate>;

export const RecurringSchedule = S.Struct({
  id: S.String,
  student_rate_id: S.String,
  student_id: S.String,
  day_of_week: S.Number.pipe(S.check(S.isInt()), S.check(S.isBetween({ minimum: 1, maximum: 7 }))),
  local_start_time: S.String,
  timezone: S.String,
  starts_on: S.String,
  ends_on: S.NullishOr(S.String),
  active: S.Boolean,
});

export type RecurringSchedule = S.Schema.Type<typeof RecurringSchedule>;

export const PaymentGenerationStatus = S.Union([
  S.Literal("pending"),
  S.Literal("processing"),
  S.Literal("generated"),
  S.Literal("failed"),
]);

export type PaymentGenerationStatus = S.Schema.Type<typeof PaymentGenerationStatus>;

export const MonthlyPayment = S.Struct({
  id: S.String,
  student_id: S.String,
  billing_month: S.String,
  amount_cents: S.Number,
  paid_at: S.String,
  notes: S.NullishOr(S.String),
  generation_status: PaymentGenerationStatus,
  generation_error: S.NullishOr(S.String),
  generated_at: S.NullishOr(S.String),
});

export type MonthlyPayment = S.Schema.Type<typeof MonthlyPayment>;

/** A student who owes a monthly prepaid payment for a month, and the payment if one is recorded. */
export const MonthlyPaymentStatus = S.Struct({
  student_id: S.String,
  student_name: S.String,
  payment: S.NullOr(MonthlyPayment),
});

export type MonthlyPaymentStatus = S.Schema.Type<typeof MonthlyPaymentStatus>;

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

const ClockTime = S.String.pipe(S.check(S.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)));

/** Opening hours for one weekday, as 24-hour HH:MM times. */
export const WorkingHoursDay = S.Struct({
  start: ClockTime,
  end: ClockTime,
}).pipe(S.check(S.makeFilter((day) => day.start < day.end)));

export type WorkingHoursDay = S.Schema.Type<typeof WorkingHoursDay>;

/** Hours per weekday, 0 = Sunday; null means closed. */
export const WorkingHours = S.Struct({
  0: S.NullOr(WorkingHoursDay),
  1: S.NullOr(WorkingHoursDay),
  2: S.NullOr(WorkingHoursDay),
  3: S.NullOr(WorkingHoursDay),
  4: S.NullOr(WorkingHoursDay),
  5: S.NullOr(WorkingHoursDay),
  6: S.NullOr(WorkingHoursDay),
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

export const BillStatus = S.Union([
  S.Literal("draft"),
  S.Literal("issued"),
  S.Literal("paid"),
  S.Literal("cancelled"),
  S.Literal("void"),
]);

export type BillStatus = S.Schema.Type<typeof BillStatus>;

export const PaymentMethod = S.Union([
  S.Literal("cash"),
  S.Literal("check"),
  S.Literal("card"),
  S.Literal("bank_transfer"),
  S.Literal("other"),
]);

export type PaymentMethod = S.Schema.Type<typeof PaymentMethod>;

export const LineItemType = S.Union([
  S.Literal("lesson"),
  S.Literal("single_booking"),
  S.Literal("fee"),
  S.Literal("adjustment"),
  S.Literal("credit"),
]);

export type LineItemType = S.Schema.Type<typeof LineItemType>;

export const Bill = S.Struct({
  id: S.String,
  payer_id: S.String,
  bill_number: S.Number,
  status: BillStatus,
  billing_period_start: S.String,
  billing_period_end: S.String,
  due_date: S.NullOr(S.String),
  subtotal_cents: S.Number,
  discount_cents: S.Number,
  tax_cents: S.Number,
  total_cents: S.Number,
  notes: S.NullOr(S.String),
  created_at: S.String,
  updated_at: S.String,
  issued_at: S.NullOr(S.String),
  paid_at: S.NullOr(S.String),
  cancelled_at: S.NullOr(S.String),
  voided_at: S.NullOr(S.String),
});

export type Bill = S.Schema.Type<typeof Bill>;

/** A single-booking bill with the lesson it charges for and what is still owed on it. */
export const LessonBill = S.Struct({
  bill_id: S.String,
  bill_number: S.Number,
  status: BillStatus,
  lesson_id: S.String,
  scheduled_at: S.String,
  student_id: S.String,
  student_name: S.String,
  payer_id: S.String,
  payer_name: S.String,
  total_cents: S.Number,
  outstanding_cents: S.Number,
});

export type LessonBill = S.Schema.Type<typeof LessonBill>;

export const Payment = S.Struct({
  id: S.String,
  payer_id: S.String,
  payment_number: S.Number,
  amount_cents: S.Number,
  method: PaymentMethod,
  reference: S.NullOr(S.String),
  received_at: S.String,
  notes: S.NullOr(S.String),
  created_at: S.String,
  updated_at: S.String,
});

export type Payment = S.Schema.Type<typeof Payment>;

// Family-facing billing views deliberately exclude internal notes and actor IDs.
export const FamilyBill = S.Struct({
  id: S.String,
  payer_id: S.String,
  bill_number: S.Number,
  status: BillStatus,
  billing_period_start: S.String,
  billing_period_end: S.String,
  due_date: S.NullOr(S.String),
  subtotal_cents: S.Number,
  discount_cents: S.Number,
  tax_cents: S.Number,
  total_cents: S.Number,
  created_at: S.String,
  updated_at: S.String,
  issued_at: S.NullOr(S.String),
  paid_at: S.NullOr(S.String),
  cancelled_at: S.NullOr(S.String),
  voided_at: S.NullOr(S.String),
});
export type FamilyBill = S.Schema.Type<typeof FamilyBill>;

export const FamilyPayment = S.Struct({
  id: S.String,
  payer_id: S.String,
  payment_number: S.Number,
  amount_cents: S.Number,
  method: PaymentMethod,
  reference: S.NullOr(S.String),
  received_at: S.String,
  created_at: S.String,
  updated_at: S.String,
});
export type FamilyPayment = S.Schema.Type<typeof FamilyPayment>;

export const Credit = S.Struct({
  id: S.String,
  payer_id: S.String,
  student_id: S.NullOr(S.String),
  amount_cents: S.Number,
  reason: S.String,
  expires_at: S.NullOr(S.String),
  consumed_at: S.NullOr(S.String),
  created_at: S.String,
});

export type Credit = S.Schema.Type<typeof Credit>;

export const AdminCredit = S.Struct({
  id: S.String,
  payer_id: S.String,
  student_id: S.NullOr(S.String),
  amount_cents: S.Number,
  reason: S.String,
  created_by: S.String,
  expires_at: S.NullOr(S.String),
  consumed_at: S.NullOr(S.String),
  created_at: S.String,
});
export type AdminCredit = S.Schema.Type<typeof AdminCredit>;

export const FamilyBillDetailResponse = S.Struct({
  id: S.String,
  payer_id: S.String,
  bill_number: S.Number,
  status: BillStatus,
  billing_period_start: S.String,
  billing_period_end: S.String,
  due_date: S.NullOr(S.String),
  subtotal_cents: S.Number,
  discount_cents: S.Number,
  tax_cents: S.Number,
  total_cents: S.Number,
  created_at: S.String,
  updated_at: S.String,
  issued_at: S.NullOr(S.String),
  paid_at: S.NullOr(S.String),
  cancelled_at: S.NullOr(S.String),
  voided_at: S.NullOr(S.String),
  line_items: S.Array(
    S.Struct({
      id: S.String,
      bill_id: S.String,
      student_id: S.String,
      line_type: LineItemType,
      description: S.String,
      quantity: S.Number,
      unit_price_cents: S.Number,
      amount_cents: S.Number,
      created_at: S.String,
    }),
  ),
  adjustments: S.Array(
    S.Struct({
      id: S.String,
      bill_id: S.String,
      amount_cents: S.Number,
      created_at: S.String,
    }),
  ),
  credit_applications: S.Array(
    S.Struct({
      id: S.String,
      credit_id: S.String,
      bill_id: S.String,
      amount_cents: S.Number,
      created_at: S.String,
    }),
  ),
});
export type FamilyBillDetailResponse = S.Schema.Type<typeof FamilyBillDetailResponse>;

export const FamilyPaymentDetail = S.Struct({
  ...FamilyPayment.fields,
  allocations: S.Array(
    S.Struct({
      id: S.String,
      payment_id: S.String,
      bill_id: S.String,
      amount_cents: S.Number,
      created_at: S.String,
    }),
  ),
});
export type FamilyPaymentDetail = S.Schema.Type<typeof FamilyPaymentDetail>;

export const BillDetailResponse = S.Struct({
  id: S.String,
  payer_id: S.String,
  bill_number: S.Number,
  status: BillStatus,
  billing_period_start: S.String,
  billing_period_end: S.String,
  due_date: S.NullOr(S.String),
  subtotal_cents: S.Number,
  discount_cents: S.Number,
  tax_cents: S.Number,
  total_cents: S.Number,
  notes: S.NullOr(S.String),
  created_at: S.String,
  updated_at: S.String,
  issued_at: S.NullOr(S.String),
  paid_at: S.NullOr(S.String),
  cancelled_at: S.NullOr(S.String),
  voided_at: S.NullOr(S.String),
  line_items: S.Array(
    S.Struct({
      id: S.String,
      bill_id: S.String,
      student_id: S.String,
      line_type: LineItemType,
      description: S.String,
      quantity: S.Number,
      unit_price_cents: S.Number,
      amount_cents: S.Number,
      created_at: S.String,
    }),
  ),
  adjustments: S.Array(
    S.Struct({
      id: S.String,
      bill_id: S.String,
      amount_cents: S.Number,
      reason: S.String,
      created_at: S.String,
    }),
  ),
  credit_applications: S.Array(
    S.Struct({
      id: S.String,
      credit_id: S.String,
      bill_id: S.String,
      amount_cents: S.Number,
      created_at: S.String,
    }),
  ),
});

export type BillDetailResponse = S.Schema.Type<typeof BillDetailResponse>;

export const PaymentDetail = S.Struct({
  id: S.String,
  payer_id: S.String,
  payment_number: S.Number,
  amount_cents: S.Number,
  method: PaymentMethod,
  reference: S.NullOr(S.String),
  received_at: S.String,
  notes: S.NullOr(S.String),
  created_at: S.String,
  updated_at: S.String,
  allocations: S.Array(
    S.Struct({
      id: S.String,
      payment_id: S.String,
      bill_id: S.String,
      amount_cents: S.Number,
      created_at: S.String,
    }),
  ),
});

export type PaymentDetail = S.Schema.Type<typeof PaymentDetail>;

export const FamilyBillingBalance = S.Struct({
  outstanding_cents: S.Number,
  credit_balance_cents: S.Number,
  available_credit_cents: S.Number,
  overdue_cents: S.Number,
  gross_outstanding_cents: S.Number,
  net_due_cents: S.Number,
});

export type FamilyBillingBalance = S.Schema.Type<typeof FamilyBillingBalance>;

// Covers every payer ledger that RLS shows the current user.
export const FamilyBillingOverview = S.Struct({
  balance: FamilyBillingBalance,
  open_bills: S.Array(FamilyBill),
  overdue_bills: S.Array(FamilyBill),
  recent_payments: S.Array(FamilyPayment),
  credits: S.Array(Credit),
});

export type FamilyBillingOverview = S.Schema.Type<typeof FamilyBillingOverview>;

export const PayerBillingSummary = S.Struct({
  payer_id: S.String,
  payer_name: S.String,
  students: S.Array(S.Struct({ id: S.String, name: S.String })),
  bill_count: S.Number,
  total_billed_cents: S.Number,
  total_paid_cents: S.Number,
  outstanding_cents: S.Number,
  overdue_cents: S.Number,
  credit_balance_cents: S.Number,
});

export type PayerBillingSummary = S.Schema.Type<typeof PayerBillingSummary>;

export const PayerBillingBalance = S.Struct({
  outstanding_cents: S.Number,
  overdue_cents: S.Number,
  credit_balance_cents: S.Number,
});

export type PayerBillingBalance = S.Schema.Type<typeof PayerBillingBalance>;

export const PayerBillingDetail = S.Struct({
  payer_id: S.String,
  payer_name: S.String,
  balance: PayerBillingBalance,
  bills: S.Array(FamilyBill),
  payments: S.Array(FamilyPayment),
  credits: S.Array(Credit),
});

export type PayerBillingDetail = S.Schema.Type<typeof PayerBillingDetail>;

export const Discount = S.Struct({
  id: S.String,
  payer_id: S.String,
  label: S.String,
  discount_type: S.Literals(["percentage", "fixed"]),
  discount_value: S.Number,
  applies_to: S.Union([S.Literal("all"), S.Literal("tuition"), S.Literal("fees")]),
  effective_from: S.String,
  effective_until: S.NullOr(S.String),
  is_active: S.Boolean,
  created_by: S.String,
  created_at: S.String,
  updated_at: S.String,
});

export type Discount = S.Schema.Type<typeof Discount>;

export const TaxRate = S.Struct({
  id: S.String,
  label: S.String,
  jurisdiction: S.String,
  rate_percent: S.Number,
  applies_to: S.Union([S.Literal("all"), S.Literal("tuition"), S.Literal("fees")]),
  effective_from: S.String,
  effective_until: S.NullOr(S.String),
  is_active: S.Boolean,
  created_by: S.String,
  created_at: S.String,
  updated_at: S.String,
});

export type TaxRate = S.Schema.Type<typeof TaxRate>;

export const TaxExemption = S.Struct({
  id: S.String,
  payer_id: S.String,
  tax_rate_id: S.String,
  exemption_reason: S.String,
  effective_from: S.String,
  effective_until: S.NullOr(S.String),
  created_by: S.String,
  created_at: S.String,
});

export type TaxExemption = S.Schema.Type<typeof TaxExemption>;

export const Refund = S.Struct({
  id: S.String,
  payment_id: S.String,
  amount_cents: S.Number,
  reason: S.String,
  created_by: S.String,
  refunded_at: S.String,
  notes: S.NullOr(S.String),
  created_at: S.String,
});

export type Refund = S.Schema.Type<typeof Refund>;

export const Adjustment = S.Struct({
  id: S.String,
  bill_id: S.String,
  amount_cents: S.Number,
  reason: S.String,
  created_at: S.String,
});

export type Adjustment = S.Schema.Type<typeof Adjustment>;

export const CreditApplication = S.Struct({
  id: S.String,
  credit_id: S.String,
  bill_id: S.String,
  amount_cents: S.Number,
  created_at: S.String,
});

export type CreditApplication = S.Schema.Type<typeof CreditApplication>;

export const CreateChildPayload = S.Struct({
  name: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200))),
});

export type CreateChildPayload = S.Schema.Type<typeof CreateChildPayload>;

export const CreateChildResponse = S.Struct({
  id: S.String,
  username: S.String,
  name: S.String,
  role: UserRole,
  is_verified: S.Boolean,
});

export type CreateChildResponse = S.Schema.Type<typeof CreateChildResponse>;
