import type { EffectKysely } from "@effect/sql-kysely/Kysely";
import { Effect, Option } from "effect";
import { sql } from "kysely";
import type { DB } from "../../generated/db.js";
import { withAuthContext } from "../db.js";
import { catchPgErrors, HttpError } from "../pgErrors.js";
import { allocatePayment } from "./billingCalculation.js";

export interface CreateBillInput {
  familyId: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  dueDate?: string;
  lineItems: Array<{
    studentId: string;
    lineType: "lesson" | "single_booking" | "fee" | "adjustment" | "credit";
    description: string;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
    lessonId?: string | null;
  }>;
  discountCents?: number;
  taxCents?: number;
  notes?: string;
}

export interface RecordPaymentInput {
  familyId: string;
  amountCents: number;
  method: "cash" | "check" | "bank_transfer" | "other" | "card";
  reference?: string | null;
  receivedAt?: Date;
  notes?: string;
  allocations: Array<{
    billId: string;
    amountCents: number;
  }>;
}

export interface ApplyCreditInput {
  creditId: string;
  billId: string;
  amountCents: number;
}

export interface CreateAdjustmentInput {
  billId: string;
  amountCents: number;
  reason: string;
}

export interface ProcessRefundInput {
  paymentId: string;
  amountCents: number;
  reason: string;
  notes?: string;
}

export interface IssueCreditInput {
  familyId: string;
  studentId?: string | null;
  amountCents: number;
  reason: string;
  expiresAt?: string | null;
}

export interface VoidBillInput {
  billId: string;
  reason: string;
}

export interface FamilyBalance {
  outstandingCents: number;
  creditBalanceCents: number;
  overdueCents: number;
}

export interface FamilyDiscountInput {
  familyId: string;
  label: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  appliesTo: "all" | "tuition" | "fees";
  effectiveFrom: string;
  effectiveUntil?: string | null;
  isActive?: boolean;
}

export interface TaxRateInput {
  label: string;
  jurisdiction: string;
  ratePercent: number;
  appliesTo: "all" | "tuition" | "fees";
  effectiveFrom: string;
  effectiveUntil?: string | null;
}

export interface FamilyTaxExemptionInput {
  familyId: string;
  taxRateId: string;
  exemptionReason: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
}

export class BillNotFoundError extends HttpError {
  constructor() {
    super(404, "Bill not found");
  }
}

export class PaymentNotFoundError extends HttpError {
  constructor() {
    super(404, "Payment not found");
  }
}

export class CreditNotFoundError extends HttpError {
  constructor() {
    super(404, "Credit not found");
  }
}

export class InvalidStateError extends HttpError {
  constructor(message: string) {
    super(409, message);
  }
}

export class CrossFamilyError extends HttpError {
  constructor() {
    super(409, "Cannot allocate across different families");
  }
}

export class RefundExceedsPaymentError extends HttpError {
  constructor() {
    super(409, "Refund exceeds unrefunded payment portion");
  }
}

export class ValidationError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

type AuthDB = EffectKysely<DB>;

export class BillingLedgerService extends Effect.Service<BillingLedgerService>()(
  "BillingLedgerService",
  {
    accessors: true,
    effect: Effect.gen(function* () {
      yield* Effect.void;
      return {
        createBill: Effect.fn("createBill")(function* (sessionId: string, input: CreateBillInput) {
          const subtotalCents = input.lineItems.reduce((sum, li) => sum + li.amountCents, 0);
          const discountCents = input.discountCents ?? 0;
          const taxCents = input.taxCents ?? 0;
          const totalCents = subtotalCents - discountCents + taxCents;

          if (totalCents < 0) {
            return yield* new InvalidStateError("Bill total cannot be negative");
          }

          const bill = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              const billNumber = yield* db
                .selectFrom(
                  db
                    .selectNoFrom((eb) =>
                      sql<number>`app_public.next_bill_number(${eb.val(input.familyId)})`.as("n"),
                    )
                    .as("t"),
                )
                .select(sql<number>`t.n`.as("n"))
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.n),
                );

              const b = yield* db
                .insertInto("app_public.bills")
                .values({
                  family_id: input.familyId,
                  bill_number: billNumber,
                  billing_period_start: input.billingPeriodStart,
                  billing_period_end: input.billingPeriodEnd,
                  due_date: input.dueDate ?? null,
                  subtotal_cents: subtotalCents,
                  discount_cents: discountCents,
                  tax_cents: taxCents,
                  total_cents: totalCents,
                  notes: input.notes ?? null,
                })
                .returning([
                  "id",
                  "family_id",
                  "bill_number",
                  "status",
                  "billing_period_start",
                  "billing_period_end",
                  "due_date",
                  "subtotal_cents",
                  "discount_cents",
                  "tax_cents",
                  "total_cents",
                  "discount_details",
                  "tax_details",
                  "notes",
                  "created_at",
                  "updated_at",
                  "issued_at",
                  "paid_at",
                  "cancelled_at",
                  "voided_at",
                ])
                .pipe(Effect.head, catchPgErrors);

              if (input.lineItems.length > 0) {
                yield* db
                  .insertInto("app_public.bill_line_items")
                  .values(
                    input.lineItems.map((li) => ({
                      bill_id: b.id,
                      student_id: li.studentId,
                      line_type: li.lineType,
                      description: li.description,
                      quantity: li.quantity,
                      unit_price_cents: li.unitPriceCents,
                      amount_cents: li.amountCents,
                      lesson_id: li.lessonId ?? null,
                    })),
                  )
                  .pipe(catchPgErrors);
              }

              return JSON.parse(JSON.stringify(b)) as typeof b;
            }),
          );

          return bill;
        }),

        issueBill: Effect.fn("issueBill")(function* (sessionId: string, billId: string) {
          const result = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              const issued = yield* db
                .updateTable("app_public.bills")
                .set({ status: "issued", issued_at: new Date() })
                .where("id", "=", billId)
                .where("status", "=", "draft")
                .returningAll()
                .pipe(Effect.head, Effect.option);

              if (Option.isSome(issued)) {
                return issued.value;
              }

              const existing = yield* db
                .selectFrom("app_public.bills")
                .select((eb) => [
                  "status",
                  eb.fn("app_public.current_user_id").as("current_user_id"),
                  eb.fn("app_public.current_user_role").as("current_user_role"),
                ])
                .where("id", "=", billId)
                .pipe(Effect.head, Effect.option);
              if (Option.isNone(existing)) {
                return yield* new BillNotFoundError();
              }
              return yield* new InvalidStateError(
                `Cannot issue bill in status: ${existing.value.status}`,
              );
            }),
          );

          return result;
        }),

        getBill: Effect.fn("getBill")(function* (sessionId: string, billId: string) {
          const bill = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.bills")
              .selectAll()
              .where("id", "=", billId)
              .pipe(Effect.head, Effect.option),
          );
          if (Option.isNone(bill)) {
            return null;
          }

          const lineItems = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.bill_line_items")
              .selectAll()
              .where("bill_id", "=", billId)
              .orderBy("created_at"),
          );

          const adjustments = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.bill_adjustments")
              .selectAll()
              .where("bill_id", "=", billId)
              .orderBy("created_at"),
          );

          const creditApplications = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.family_credit_applications")
              .selectAll()
              .where("bill_id", "=", billId)
              .orderBy("created_at"),
          );

          return { ...bill.value, lineItems, adjustments, creditApplications };
        }),

        billLineItems: Effect.fn("billLineItems")(function* (sessionId: string, billId: string) {
          const items = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.bill_line_items")
              .selectAll()
              .where("bill_id", "=", billId)
              .orderBy("created_at"),
          );
          return items;
        }),

        listFamilyBills: Effect.fn("listFamilyBills")(function* (
          sessionId: string,
          familyId: string,
        ) {
          const bills = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.bills")
              .selectAll()
              .where("family_id", "=", familyId)
              .orderBy("created_at", "desc"),
          );
          return bills;
        }),

        voidBill: Effect.fn("voidBill")(function* (sessionId: string, input: VoidBillInput) {
          const result = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              const bill = yield* db
                .selectFrom("app_public.bills")
                .select(["id", "status", "family_id"])
                .where("id", "=", input.billId)
                .pipe(Effect.head, Effect.option);
              if (Option.isNone(bill)) {
                return yield* new BillNotFoundError();
              }
              if (bill.value.status === "draft") {
                return yield* new InvalidStateError("Cannot void a draft bill; cancel it instead");
              }
              if (bill.value.status === "void") {
                return yield* new InvalidStateError("Bill is already voided");
              }
              if (bill.value.status === "cancelled") {
                return yield* new InvalidStateError("Bill is already cancelled");
              }

              return yield* db
                .updateTable("app_public.bills")
                .set({
                  status: "void",
                  voided_at: new Date(),
                  notes: sql<string>`case when notes is null or notes = '' then ${input.reason} else notes || E'\\nVoid reason: ' || ${input.reason} end`,
                })
                .where("id", "=", input.billId)
                .returningAll()
                .pipe(Effect.head, catchPgErrors);
            }),
          );
          return result;
        }),

        cancelBill: Effect.fn("cancelBill")(function* (sessionId: string, billId: string) {
          const result = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              const cancelled = yield* db
                .updateTable("app_public.bills")
                .set({ status: "cancelled", cancelled_at: new Date() })
                .where("id", "=", billId)
                .where("status", "=", "draft")
                .returningAll()
                .pipe(Effect.head, Effect.option);

              if (Option.isSome(cancelled)) {
                return cancelled.value;
              }

              const existing = yield* db
                .selectFrom("app_public.bills")
                .select("status")
                .where("id", "=", billId)
                .pipe(Effect.head, Effect.option);
              if (Option.isNone(existing)) {
                return yield* new BillNotFoundError();
              }
              return yield* new InvalidStateError(
                `Cannot cancel bill in status: ${existing.value.status}`,
              );
            }),
          );
          return result;
        }),

        recordPayment: Effect.fn("recordPayment")(function* (
          sessionId: string,
          input: RecordPaymentInput,
        ) {
          if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
            return yield* new ValidationError("Payment amount must be a positive number of cents");
          }
          if (input.receivedAt && input.receivedAt > new Date()) {
            return yield* new ValidationError("Payment date cannot be in the future");
          }

          const totalAllocated = input.allocations.reduce((sum, a) => sum + a.amountCents, 0);
          if (
            input.allocations.some((a) => !Number.isInteger(a.amountCents) || a.amountCents <= 0)
          ) {
            return yield* new ValidationError(
              "Allocation amounts must be positive numbers of cents",
            );
          }
          if (input.allocations.length > 0 && totalAllocated > input.amountCents) {
            return yield* new InvalidStateError(
              `Allocation total (${totalAllocated}) cannot exceed payment amount (${input.amountCents})`,
            );
          }

          const payment = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              const bills = yield* db
                .selectFrom("app_public.bills as b")
                .select([
                  "b.id",
                  "b.total_cents",
                  "b.due_date",
                  "b.status",
                  sql<number>`coalesce((select sum(amount_cents) from app_public.bill_adjustments where bill_id = b.id), 0)`.as(
                    "adjustments",
                  ),
                  sql<number>`coalesce((select sum(amount_cents) from app_public.family_credit_applications where bill_id = b.id), 0)`.as(
                    "credits",
                  ),
                  sql<number>`coalesce((select sum(amount_cents) from app_public.payment_allocations where bill_id = b.id), 0)`.as(
                    "payments",
                  ),
                ])
                .where("b.family_id", "=", input.familyId)
                .where("b.status", "in", ["issued", "paid"])
                .orderBy("b.due_date", "asc")
                .orderBy("b.created_at", "asc");

              const allocations = allocatePayment({
                paymentAmountCents: input.amountCents,
                explicitAllocations: input.allocations.map((allocation) => ({
                  billId: allocation.billId,
                  amountCents: allocation.amountCents,
                })),
                bills: bills.map((bill) => ({
                  id: bill.id,
                  totalCents: bill.total_cents,
                  adjustmentsCents: Number(bill.adjustments),
                  creditsAppliedCents: Number(bill.credits),
                  paidCents: Number(bill.payments),
                  dueDate: bill.due_date ? String(bill.due_date).slice(0, 10) : null,
                  status: bill.status,
                })),
              });

              const requestedByBill = new Map<string, number>();
              for (const a of allocations) {
                requestedByBill.set(a.billId, (requestedByBill.get(a.billId) ?? 0) + a.amountCents);
              }
              for (const a of allocations) {
                const bill = yield* db
                  .selectFrom("app_public.bills as b")
                  .select([
                    "b.family_id",
                    "b.status",
                    "b.total_cents",
                    sql<number>`coalesce((select sum(amount_cents) from app_public.bill_adjustments where bill_id = b.id), 0)`.as(
                      "adjustments",
                    ),
                    sql<number>`coalesce((select sum(amount_cents) from app_public.family_credit_applications where bill_id = b.id), 0)`.as(
                      "credits",
                    ),
                    sql<number>`coalesce((select sum(amount_cents) from app_public.payment_allocations where bill_id = b.id), 0)`.as(
                      "payments",
                    ),
                  ])
                  .where("id", "=", a.billId)
                  .pipe(Effect.head, Effect.option);
                if (Option.isNone(bill)) {
                  return yield* new BillNotFoundError();
                }
                if (bill.value.family_id !== input.familyId) {
                  return yield* new CrossFamilyError();
                }
                if (bill.value.status !== "issued" && bill.value.status !== "paid") {
                  return yield* new InvalidStateError(
                    "Payments can only be allocated to issued bills",
                  );
                }
                const outstanding = Math.max(
                  0,
                  bill.value.total_cents +
                    Number(bill.value.adjustments) -
                    Number(bill.value.credits) -
                    Number(bill.value.payments),
                );
                if ((requestedByBill.get(a.billId) ?? 0) > outstanding) {
                  return yield* new InvalidStateError(
                    `Allocation exceeds bill outstanding balance (${outstanding})`,
                  );
                }
              }

              const paymentNumber = yield* db
                .selectFrom(
                  db
                    .selectNoFrom((eb) =>
                      sql<number>`app_public.next_payment_number(${eb.val(input.familyId)})`.as(
                        "n",
                      ),
                    )
                    .as("t"),
                )
                .select(sql<number>`t.n`.as("n"))
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.n),
                );

              const p = yield* db
                .insertInto("app_public.payments")
                .values({
                  family_id: input.familyId,
                  payment_number: paymentNumber,
                  amount_cents: input.amountCents,
                  method: input.method,
                  reference: input.reference ?? null,
                  received_at: input.receivedAt ?? new Date(),
                  notes: input.notes ?? null,
                })
                .returningAll()
                .pipe(Effect.head, catchPgErrors);

              if (allocations.length > 0) {
                yield* db
                  .insertInto("app_public.payment_allocations")
                  .values(
                    allocations.map((a) => ({
                      payment_id: p.id,
                      bill_id: a.billId,
                      amount_cents: a.amountCents,
                    })),
                  )
                  .pipe(catchPgErrors);
              }

              const allocatedCents = allocations.reduce(
                (sum, allocation) => sum + allocation.amountCents,
                0,
              );
              const excessCents = input.amountCents - allocatedCents;
              if (excessCents > 0) {
                yield* db
                  .insertInto("app_public.family_credits")
                  .values({
                    family_id: input.familyId,
                    student_id: null,
                    amount_cents: excessCents,
                    reason: `Excess payment credit from payment ${p.payment_number}`,
                    created_by: sql<string>`app_public.current_user_id()`,
                    source_payment_id: p.id,
                    expires_at: null,
                    consumed_at: null,
                  })
                  .pipe(catchPgErrors);
              }

              for (const billId of requestedByBill.keys()) {
                const balance = yield* db
                  .selectFrom("app_public.bills as b")
                  .select([
                    "b.total_cents",
                    "b.status",
                    sql<number>`coalesce((select sum(amount_cents) from app_public.bill_adjustments where bill_id = b.id), 0)`.as(
                      "adjustments",
                    ),
                    sql<number>`coalesce((select sum(amount_cents) from app_public.family_credit_applications where bill_id = b.id), 0)`.as(
                      "credits",
                    ),
                    sql<number>`coalesce((select sum(amount_cents) from app_public.payment_allocations where bill_id = b.id), 0)`.as(
                      "payments",
                    ),
                  ])
                  .where("b.id", "=", billId)
                  .pipe(Effect.head);
                const outstanding =
                  balance.total_cents +
                  Number(balance.adjustments) -
                  Number(balance.credits) -
                  Number(balance.payments);
                if (outstanding <= 0 && balance.status === "issued") {
                  yield* db
                    .updateTable("app_public.bills")
                    .set({ status: "paid", paid_at: new Date() })
                    .where("id", "=", billId)
                    .returning("id")
                    .pipe(Effect.head);
                }
              }

              return p;
            }),
          );

          return payment;
        }),

        listFamilyPayments: Effect.fn("listFamilyPayments")(function* (
          sessionId: string,
          familyId: string,
        ) {
          const payments = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.payments")
              .selectAll()
              .where("family_id", "=", familyId)
              .orderBy("received_at", "desc"),
          );
          return payments;
        }),

        applyCredit: Effect.fn("applyCredit")(function* (
          sessionId: string,
          input: ApplyCreditInput,
        ) {
          const app = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
                return yield* new ValidationError(
                  "Credit application must be a positive number of cents",
                );
              }
              const bill = yield* db
                .selectFrom("app_public.bills")
                .select([
                  "family_id",
                  "status",
                  "total_cents",
                  sql<number>`coalesce((select sum(amount_cents) from app_public.bill_adjustments where bill_id = app_public.bills.id), 0)`.as(
                    "adjustments",
                  ),
                  sql<number>`coalesce((select sum(amount_cents) from app_public.family_credit_applications where bill_id = app_public.bills.id), 0)`.as(
                    "credits",
                  ),
                  sql<number>`coalesce((select sum(amount_cents) from app_public.payment_allocations where bill_id = app_public.bills.id), 0)`.as(
                    "payments",
                  ),
                ])
                .where("id", "=", input.billId)
                .pipe(Effect.head, Effect.option);
              if (Option.isNone(bill)) {
                return yield* new BillNotFoundError();
              }
              if (bill.value.status !== "issued" && bill.value.status !== "paid") {
                return yield* new InvalidStateError("Credits can only be applied to issued bills");
              }

              const credit = yield* db
                .selectFrom("app_public.family_credits")
                .selectAll()
                .where("id", "=", input.creditId)
                .forUpdate()
                .pipe(Effect.head, Effect.option);
              if (Option.isNone(credit)) {
                return yield* new CreditNotFoundError();
              }
              if (credit.value.consumed_at !== null) {
                return yield* new InvalidStateError("Credit has already been fully consumed");
              }
              if (credit.value.family_id !== bill.value.family_id) {
                return yield* new CrossFamilyError();
              }

              const alreadyApplied = yield* db
                .selectFrom("app_public.family_credit_applications")
                .select(sql<number>`COALESCE(SUM(amount_cents), 0)`.as("total_applied"))
                .where("credit_id", "=", input.creditId)
                .pipe(
                  Effect.head,
                  Effect.map((r) => Number(r.total_applied)),
                );

              const remaining = credit.value.amount_cents - alreadyApplied;
              if (input.amountCents > remaining) {
                return yield* new InvalidStateError(
                  `Credit remaining (${remaining}) is less than requested application (${input.amountCents})`,
                );
              }
              const outstanding = Math.max(
                0,
                bill.value.total_cents +
                  Number(bill.value.adjustments) -
                  Number(bill.value.credits) -
                  Number(bill.value.payments),
              );
              if (input.amountCents > outstanding) {
                return yield* new InvalidStateError(
                  `Credit application exceeds bill outstanding balance (${outstanding})`,
                );
              }

              const application = yield* db
                .insertInto("app_public.family_credit_applications")
                .values({
                  credit_id: input.creditId,
                  bill_id: input.billId,
                  amount_cents: input.amountCents,
                })
                .returningAll()
                .pipe(Effect.head, catchPgErrors);
              if (outstanding - input.amountCents <= 0 && bill.value.status === "issued") {
                yield* db
                  .updateTable("app_public.bills")
                  .set({ status: "paid", paid_at: new Date() })
                  .where("id", "=", input.billId)
                  .returning("id")
                  .pipe(Effect.head);
              }
              return application;
            }),
          );

          return app;
        }),

        createAdjustment: Effect.fn("createAdjustment")(function* (
          sessionId: string,
          input: CreateAdjustmentInput,
        ) {
          if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
            return yield* new ValidationError("Adjustment must be a non-zero number of cents");
          }
          if (!input.reason || input.reason.trim().length === 0) {
            return yield* new ValidationError("Reason is required for an adjustment");
          }
          const adj = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              const bill = yield* db
                .selectFrom("app_public.bills")
                .select(["id", "status"])
                .where("id", "=", input.billId)
                .pipe(Effect.head, Effect.option);
              if (Option.isNone(bill)) {
                return yield* new BillNotFoundError();
              }
              if (bill.value.status === "draft") {
                return yield* new InvalidStateError(
                  "Cannot adjust a draft bill; add line items instead",
                );
              }
              if (bill.value.status === "void" || bill.value.status === "cancelled") {
                return yield* new InvalidStateError("Cannot adjust a cancelled or voided bill");
              }

              const userId = yield* db
                .selectFrom(
                  db
                    .selectNoFrom(() => sql<string>`app_public.current_user_id()`.as("uid"))
                    .as("t"),
                )
                .select(sql<string>`t.uid`.as("user_id"))
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.user_id),
                );

              return yield* db
                .insertInto("app_public.bill_adjustments")
                .values({
                  bill_id: input.billId,
                  amount_cents: input.amountCents,
                  reason: input.reason,
                  created_by: userId,
                })
                .returningAll()
                .pipe(Effect.head, catchPgErrors);
            }),
          );

          return adj;
        }),

        processRefund: Effect.fn("processRefund")(function* (
          sessionId: string,
          input: ProcessRefundInput,
        ) {
          if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
            return yield* new ValidationError("Refund amount must be a positive number of cents");
          }
          if (!input.reason || input.reason.trim().length === 0) {
            return yield* new ValidationError("Reason is required for a refund");
          }
          const refund = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              const payment = yield* db
                .selectFrom("app_public.payments")
                .selectAll()
                .where("id", "=", input.paymentId)
                .pipe(Effect.head, Effect.option);
              if (Option.isNone(payment)) {
                return yield* new PaymentNotFoundError();
              }

              const totalRefunded = yield* db
                .selectFrom("app_public.refunds")
                .select(sql<number>`COALESCE(SUM(amount_cents), 0)`.as("total_refunded"))
                .where("payment_id", "=", input.paymentId)
                .where("reversed_at", "is", null)
                .pipe(
                  Effect.head,
                  Effect.map((r) => Number(r.total_refunded)),
                );

              const remaining = payment.value.amount_cents - totalRefunded;
              if (input.amountCents > remaining) {
                return yield* new RefundExceedsPaymentError();
              }

              const userId = yield* db
                .selectFrom(
                  db
                    .selectNoFrom(() => sql<string>`app_public.current_user_id()`.as("uid"))
                    .as("t"),
                )
                .select(sql<string>`t.uid`.as("user_id"))
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.user_id),
                );

              return yield* db
                .insertInto("app_public.refunds")
                .values({
                  payment_id: input.paymentId,
                  amount_cents: input.amountCents,
                  reason: input.reason,
                  created_by: userId,
                  refunded_at: new Date(),
                  notes: input.notes ?? null,
                })
                .returningAll()
                .pipe(Effect.head, catchPgErrors);
            }),
          );

          return refund;
        }),

        listFamilyCredits: Effect.fn("listFamilyCredits")(function* (
          sessionId: string,
          familyId: string,
        ) {
          const credits = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.family_credits")
              .selectAll()
              .where("family_id", "=", familyId)
              .orderBy("created_at", "desc"),
          );
          return credits;
        }),

        issueCredit: Effect.fn("issueCredit")(function* (
          sessionId: string,
          input: IssueCreditInput,
        ) {
          if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
            return yield* new ValidationError("Credit amount must be a positive number of cents");
          }
          if (!input.reason || input.reason.trim().length === 0) {
            return yield* new ValidationError("Reason is required when issuing a credit");
          }

          const credit = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              const userId = yield* db
                .selectFrom(
                  db
                    .selectNoFrom(() => sql<string>`app_public.current_user_id()`.as("uid"))
                    .as("t"),
                )
                .select(sql<string>`t.uid`.as("user_id"))
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.user_id),
                );

              return yield* db
                .insertInto("app_public.family_credits")
                .values({
                  family_id: input.familyId,
                  student_id: input.studentId ?? null,
                  amount_cents: input.amountCents,
                  reason: input.reason,
                  created_by: userId,
                  expires_at: input.expiresAt ?? null,
                })
                .returningAll()
                .pipe(Effect.head, catchPgErrors);
            }),
          );

          return credit;
        }),

        getFamilyBalance: Effect.fn("getFamilyBalance")(function* (
          sessionId: string,
          familyId: string,
        ) {
          const bills = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.bills")
              .select(["id", "status", "total_cents", "due_date"])
              .where("family_id", "=", familyId),
          );

          const billIds = bills.map((b) => b.id);
          const adjustments = billIds.length
            ? yield* withAuthContext(sessionId, (db: AuthDB) =>
                db
                  .selectFrom("app_public.bill_adjustments")
                  .select(["bill_id", "amount_cents"])
                  .where("bill_id", "in", billIds),
              )
            : [];
          const creditApplications = billIds.length
            ? yield* withAuthContext(sessionId, (db: AuthDB) =>
                db
                  .selectFrom("app_public.family_credit_applications")
                  .select(["bill_id", "amount_cents"])
                  .where("bill_id", "in", billIds),
              )
            : [];

          const payments = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.payments")
              .select(["id", "amount_cents"])
              .where("family_id", "=", familyId),
          );

          const paymentIds = payments.map((p) => p.id);

          const allocations = paymentIds.length
            ? yield* withAuthContext(sessionId, (db: AuthDB) =>
                db
                  .selectFrom("app_public.payment_allocations")
                  .select(["payment_id", "bill_id", "amount_cents"])
                  .where("payment_id", "in", paymentIds),
              )
            : [];
          const refunds = paymentIds.length
            ? yield* withAuthContext(sessionId, (db: AuthDB) =>
                db
                  .selectFrom("app_public.refunds")
                  .select(["payment_id", "amount_cents"])
                  .where("payment_id", "in", paymentIds)
                  .where("reversed_at", "is", null),
              )
            : [];
          const refundedByPayment = new Map<string, number>();
          for (const r of refunds)
            refundedByPayment.set(
              r.payment_id,
              (refundedByPayment.get(r.payment_id) ?? 0) + r.amount_cents,
            );
          const allocationByBill = new Map<string, number>();
          const allocationByPayment = new Map<string, number>();
          for (const a of allocations) {
            allocationByBill.set(
              a.bill_id,
              (allocationByBill.get(a.bill_id) ?? 0) + a.amount_cents,
            );
            allocationByPayment.set(
              a.payment_id,
              (allocationByPayment.get(a.payment_id) ?? 0) + a.amount_cents,
            );
          }
          const adjustmentByBill = new Map<string, number>();
          for (const a of adjustments)
            adjustmentByBill.set(
              a.bill_id,
              (adjustmentByBill.get(a.bill_id) ?? 0) + a.amount_cents,
            );
          const creditByBill = new Map<string, number>();
          for (const a of creditApplications)
            creditByBill.set(a.bill_id, (creditByBill.get(a.bill_id) ?? 0) + a.amount_cents);

          const issuedBillsTotal = bills
            .filter((b) => b.status === "issued" || b.status === "paid")
            .reduce(
              (sum, b) =>
                sum +
                b.total_cents +
                (adjustmentByBill.get(b.id) ?? 0) -
                (creditByBill.get(b.id) ?? 0),
              0,
            );

          const effectiveAllocated = allocations.reduce((sum, a) => {
            const payment = payments.find((p) => p.id === a.payment_id);
            const refunded = refundedByPayment.get(a.payment_id) ?? 0;
            const allocated = allocationByPayment.get(a.payment_id) ?? 0;
            return (
              sum +
              Math.min(
                a.amount_cents,
                (Math.max(0, (payment?.amount_cents ?? 0) - refunded) * a.amount_cents) /
                  Math.max(1, allocated),
              )
            );
          }, 0);
          const outstandingCents = Math.max(0, issuedBillsTotal - Math.floor(effectiveAllocated));
          const effectiveAllocatedByBill = new Map<string, number>();
          for (const a of allocations) {
            const payment = payments.find((p) => p.id === a.payment_id);
            const refunded = refundedByPayment.get(a.payment_id) ?? 0;
            const allocated = allocationByPayment.get(a.payment_id) ?? 0;
            const effective = Math.min(
              a.amount_cents,
              (Math.max(0, (payment?.amount_cents ?? 0) - refunded) * a.amount_cents) /
                Math.max(1, allocated),
            );
            effectiveAllocatedByBill.set(
              a.bill_id,
              (effectiveAllocatedByBill.get(a.bill_id) ?? 0) + effective,
            );
          }
          const overdueCents = bills
            .filter(
              (b) =>
                (b.status === "issued" || b.status === "paid") &&
                b.due_date &&
                new Date(b.due_date) < new Date(),
            )
            .reduce(
              (sum, b) =>
                sum +
                Math.max(
                  0,
                  b.total_cents +
                    (adjustmentByBill.get(b.id) ?? 0) -
                    (creditByBill.get(b.id) ?? 0) -
                    Math.floor(effectiveAllocatedByBill.get(b.id) ?? 0),
                ),
              0,
            );

          const credits = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.family_credits as c")
              .leftJoin("app_public.family_credit_applications as ca", "ca.credit_id", "c.id")
              .select(["c.id", "c.amount_cents", "c.expires_at", "c.source_payment_id"])
              .select(sql<number>`coalesce(sum(ca.amount_cents), 0)`.as("applied_cents"))
              .where("c.family_id", "=", familyId)
              .groupBy(["c.id", "c.amount_cents", "c.expires_at"]),
          );
          const unexpiredCredits = credits.reduce(
            (sum, c) =>
              sum +
              (c.expires_at && new Date(c.expires_at) <= new Date()
                ? 0
                : Math.max(0, c.amount_cents - Number(c.applied_cents))),
            0,
          );

          const materializedCreditPaymentIds = new Set(
            credits.filter((c) => c.source_payment_id !== null).map((c) => c.source_payment_id),
          );
          const unallocatedPayments = payments.reduce(
            (sum, p) =>
              materializedCreditPaymentIds.has(p.id)
                ? sum
                : sum +
                  Math.max(
                    0,
                    p.amount_cents -
                      (refundedByPayment.get(p.id) ?? 0) -
                      (allocationByPayment.get(p.id) ?? 0),
                  ),
            0,
          );

          return {
            outstandingCents,
            creditBalanceCents: unexpiredCredits + Math.max(0, unallocatedPayments),
            overdueCents,
          };
        }),

        // Discount/Tax configuration operations

        createDiscount: Effect.fn("createDiscount")(function* (
          sessionId: string,
          input: FamilyDiscountInput,
        ) {
          if (
            input.discountType === "percentage" &&
            (input.discountValue < 1 || input.discountValue > 100)
          ) {
            return yield* new ValidationError("Percentage discount must be between 1 and 100");
          }
          if (input.discountType === "fixed" && input.discountValue <= 0) {
            return yield* new ValidationError("Fixed discount amount must be positive");
          }

          const discount = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              const userId = yield* db
                .selectFrom(
                  db
                    .selectNoFrom(() => sql<string>`app_public.current_user_id()`.as("uid"))
                    .as("t"),
                )
                .select(sql<string>`t.uid`.as("user_id"))
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.user_id),
                );

              return yield* db
                .insertInto("app_public.family_discounts")
                .values({
                  family_id: input.familyId,
                  label: input.label,
                  discount_type: input.discountType,
                  discount_value: input.discountValue,
                  applies_to: input.appliesTo,
                  effective_from: input.effectiveFrom,
                  effective_until: input.effectiveUntil ?? null,
                  created_by: userId,
                })
                .returningAll()
                .pipe(Effect.head, catchPgErrors);
            }),
          );
          return discount;
        }),

        updateDiscount: Effect.fn("updateDiscount")(function* (
          sessionId: string,
          discountId: string,
          input: Partial<FamilyDiscountInput>,
        ) {
          if (
            input.discountType === "percentage" &&
            input.discountValue !== undefined &&
            (input.discountValue < 1 || input.discountValue > 100)
          ) {
            return yield* new ValidationError("Percentage discount must be between 1 and 100");
          }
          if (
            input.discountType === "fixed" &&
            input.discountValue !== undefined &&
            input.discountValue <= 0
          ) {
            return yield* new ValidationError("Fixed discount amount must be positive");
          }

          const updates: Record<string, unknown> = {};
          if (input.label !== undefined) updates.label = input.label;
          if (input.discountType !== undefined) updates.discount_type = input.discountType;
          if (input.discountValue !== undefined) updates.discount_value = input.discountValue;
          if (input.appliesTo !== undefined) updates.applies_to = input.appliesTo;
          if (input.effectiveFrom !== undefined) updates.effective_from = input.effectiveFrom;
          if (input.effectiveUntil !== undefined) updates.effective_until = input.effectiveUntil;
          if (input.isActive !== undefined) updates.is_active = input.isActive;

          const discount = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              return yield* db
                .updateTable("app_public.family_discounts")
                .set(updates)
                .where("id", "=", discountId)
                .returningAll()
                .pipe(Effect.head, catchPgErrors);
            }),
          );
          return discount;
        }),

        listFamilyDiscounts: Effect.fn("listFamilyDiscounts")(function* (
          sessionId: string,
          familyId: string,
        ) {
          const discounts = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.family_discounts")
              .selectAll()
              .where("family_id", "=", familyId)
              .orderBy("effective_from", "desc"),
          );
          return discounts;
        }),

        createTaxRate: Effect.fn("createTaxRate")(function* (
          sessionId: string,
          input: TaxRateInput,
        ) {
          if (
            !Number.isFinite(input.ratePercent) ||
            Math.round(input.ratePercent * 100) !== input.ratePercent * 100 ||
            input.ratePercent < 0 ||
            input.ratePercent > 30
          ) {
            return yield* new ValidationError("Tax rate must be between 0 and 30 percent");
          }

          const rate = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              const userId = yield* db
                .selectFrom(
                  db
                    .selectNoFrom(() => sql<string>`app_public.current_user_id()`.as("uid"))
                    .as("t"),
                )
                .select(sql<string>`t.uid`.as("user_id"))
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.user_id),
                );

              return yield* db
                .insertInto("app_public.tax_rates")
                .values({
                  label: input.label,
                  jurisdiction: input.jurisdiction,
                  rate_percent: input.ratePercent,
                  applies_to: input.appliesTo,
                  effective_from: input.effectiveFrom,
                  effective_until: input.effectiveUntil ?? null,
                  created_by: userId,
                })
                .returningAll()
                .pipe(Effect.head, catchPgErrors);
            }),
          );
          return rate;
        }),

        updateTaxRate: Effect.fn("updateTaxRate")(function* (
          sessionId: string,
          taxRateId: string,
          input: Partial<TaxRateInput>,
        ) {
          if (
            input.ratePercent !== undefined &&
            (!Number.isFinite(input.ratePercent) ||
              Math.round(input.ratePercent * 100) !== input.ratePercent * 100 ||
              input.ratePercent < 0 ||
              input.ratePercent > 30)
          ) {
            return yield* new ValidationError("Tax rate must be between 0 and 30 percent");
          }

          const updates: Record<string, unknown> = {};
          if (input.label !== undefined) updates.label = input.label;
          if (input.jurisdiction !== undefined) updates.jurisdiction = input.jurisdiction;
          if (input.ratePercent !== undefined) updates.rate_percent = input.ratePercent;
          if (input.appliesTo !== undefined) updates.applies_to = input.appliesTo;
          if (input.effectiveFrom !== undefined) updates.effective_from = input.effectiveFrom;
          if (input.effectiveUntil !== undefined) updates.effective_until = input.effectiveUntil;

          const rate = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              return yield* db
                .updateTable("app_public.tax_rates")
                .set(updates)
                .where("id", "=", taxRateId)
                .returningAll()
                .pipe(Effect.head, catchPgErrors);
            }),
          );
          return rate;
        }),

        listTaxRates: Effect.fn("listTaxRates")(function* (sessionId: string) {
          const rates = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db.selectFrom("app_public.tax_rates").selectAll().orderBy("effective_from", "desc"),
          );
          return rates;
        }),

        createTaxExemption: Effect.fn("createTaxExemption")(function* (
          sessionId: string,
          input: FamilyTaxExemptionInput,
        ) {
          const exemption = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: AuthDB) {
              const userId = yield* db
                .selectFrom(
                  db
                    .selectNoFrom(() => sql<string>`app_public.current_user_id()`.as("uid"))
                    .as("t"),
                )
                .select(sql<string>`t.uid`.as("user_id"))
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.user_id),
                );

              return yield* db
                .insertInto("app_public.family_tax_exemptions")
                .values({
                  family_id: input.familyId,
                  tax_rate_id: input.taxRateId,
                  exemption_reason: input.exemptionReason,
                  effective_from: input.effectiveFrom,
                  effective_until: input.effectiveUntil ?? null,
                  created_by: userId,
                })
                .returningAll()
                .pipe(Effect.head, catchPgErrors);
            }),
          );
          return exemption;
        }),

        listFamilyTaxExemptions: Effect.fn("listFamilyTaxExemptions")(function* (
          sessionId: string,
          familyId: string,
        ) {
          const exemptions = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.family_tax_exemptions")
              .selectAll()
              .where("family_id", "=", familyId)
              .orderBy("effective_from", "desc"),
          );
          return exemptions;
        }),

        listAllFamiliesWithBilling: Effect.fn("listAllFamiliesWithBilling")(function* (
          sessionId: string,
        ) {
          const families = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db.selectFrom("app_public.families").select(["id", "name"]).orderBy("name"),
          );

          const [allBills, allPayments, allCredits] = yield* Effect.all([
            withAuthContext(sessionId, (db: AuthDB) =>
              db.selectFrom("app_public.bills").selectAll(),
            ),
            withAuthContext(sessionId, (db: AuthDB) =>
              db.selectFrom("app_public.payments").selectAll(),
            ),
            withAuthContext(sessionId, (db: AuthDB) =>
              db.selectFrom("app_public.family_credits").selectAll(),
            ),
          ]);

          const payMap = new Map<string, typeof allPayments>();
          for (const p of allPayments) {
            const arr = payMap.get(p.family_id);
            if (arr) arr.push(p);
            else payMap.set(p.family_id, [p]);
          }

          const billMap = new Map<string, typeof allBills>();
          for (const b of allBills) {
            const arr = billMap.get(b.family_id);
            if (arr) arr.push(b);
            else billMap.set(b.family_id, [b]);
          }

          const creditMap = new Map<string, typeof allCredits>();
          for (const c of allCredits) {
            const arr = creditMap.get(c.family_id);
            if (arr) arr.push(c);
            else creditMap.set(c.family_id, [c]);
          }

          const allPaymentIds = allPayments.map((p) => p.id);
          let allocSumByPayment: Map<string, number> | undefined;
          if (allPaymentIds.length > 0) {
            const allocRows = yield* withAuthContext(sessionId, (db: AuthDB) =>
              db
                .selectFrom("app_public.payment_allocations")
                .select(["payment_id", "amount_cents"])
                .where("payment_id", "in", allPaymentIds),
            );
            allocSumByPayment = new Map();
            for (const a of allocRows) {
              allocSumByPayment.set(
                a.payment_id,
                (allocSumByPayment.get(a.payment_id) ?? 0) + a.amount_cents,
              );
            }
          }

          const unpaidAllocByBill = new Map<string, number>();
          if (allPaymentIds.length > 0) {
            const billPaidRows = yield* withAuthContext(sessionId, (db: AuthDB) =>
              db
                .selectFrom("app_public.payment_allocations")
                .select(["bill_id", "amount_cents"])
                .where("payment_id", "in", allPaymentIds),
            );
            for (const a of billPaidRows) {
              unpaidAllocByBill.set(
                a.bill_id,
                (unpaidAllocByBill.get(a.bill_id) ?? 0) + a.amount_cents,
              );
            }
          }

          const summaries: Array<{
            family_id: string;
            family_name: string;
            bill_count: number;
            total_billed_cents: number;
            total_paid_cents: number;
            outstanding_cents: number;
            overdue_cents: number;
            credit_balance_cents: number;
          }> = [];

          for (const family of families) {
            const familyBills = billMap.get(family.id) ?? [];
            const familyPayments = payMap.get(family.id) ?? [];
            const familyCredits = creditMap.get(family.id) ?? [];

            const issuedBills = familyBills.filter(
              (b) => b.status === "issued" || b.status === "paid",
            );
            const totalBilledCents = issuedBills.reduce((s, b) => s + b.total_cents, 0);

            let totalPaidCents = 0;
            for (const p of familyPayments) {
              const allocTotal = allocSumByPayment?.get(p.id) ?? 0;
              totalPaidCents += allocTotal;
            }

            const outstandingCents = Math.max(0, totalBilledCents - totalPaidCents);

            const now = new Date();
            const overdueBills = issuedBills.filter(
              (b) => b.status === "issued" && b.due_date && new Date(b.due_date) < now,
            );
            const overdueTotal = overdueBills.reduce((s, b) => s + b.total_cents, 0);
            let overduePaid = 0;
            for (const b of overdueBills) {
              overduePaid += unpaidAllocByBill.get(b.id) ?? 0;
            }
            const overdueCents = Math.max(0, overdueTotal - overduePaid);

            const activeCredits = familyCredits
              .filter((c) => c.consumed_at === null)
              .reduce((s, c) => s + c.amount_cents, 0);

            const payTotal = familyPayments.reduce((s, p) => s + p.amount_cents, 0);
            const materializedCreditTotal = familyCredits
              .filter((c) => c.source_payment_id !== null)
              .reduce((s, c) => s + c.amount_cents, 0);
            const unallocatedPayments = payTotal - totalPaidCents - materializedCreditTotal;
            summaries.push({
              family_id: family.id,
              family_name: family.name,
              bill_count: issuedBills.length,
              total_billed_cents: totalBilledCents,
              total_paid_cents: totalPaidCents,
              outstanding_cents: outstandingCents,
              overdue_cents: overdueCents,
              credit_balance_cents: activeCredits + Math.max(0, unallocatedPayments),
            });
          }

          return summaries;
        }),

        getFamilyBillingDetail: Effect.fn("getFamilyBillingDetail")(function* (
          sessionId: string,
          familyId: string,
        ) {
          const family = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.families")
              .select(["id", "name"])
              .where("id", "=", familyId),
          ).pipe(Effect.head);

          const [bills, payments, credits] = yield* Effect.all([
            withAuthContext(sessionId, (db: AuthDB) =>
              db
                .selectFrom("app_public.bills")
                .selectAll()
                .where("family_id", "=", familyId)
                .orderBy("created_at", "desc"),
            ),
            withAuthContext(sessionId, (db: AuthDB) =>
              db
                .selectFrom("app_public.payments")
                .selectAll()
                .where("family_id", "=", familyId)
                .orderBy("received_at", "desc"),
            ),
            withAuthContext(sessionId, (db: AuthDB) =>
              db
                .selectFrom("app_public.family_credits")
                .selectAll()
                .where("family_id", "=", familyId)
                .orderBy("created_at", "desc"),
            ),
          ]);

          const issuedBills = bills.filter((b) => b.status === "issued" || b.status === "paid");
          const grossOutstandingCents = issuedBills.reduce((s, b) => s + b.total_cents, 0);

          const paymentIds = payments.map((p) => p.id);
          let totalAllocatedCents = 0;
          if (paymentIds.length > 0) {
            const allocResult = yield* withAuthContext(sessionId, (db: AuthDB) =>
              db
                .selectFrom("app_public.payment_allocations")
                .select(sql<number>`COALESCE(SUM(amount_cents), 0)`.as("total"))
                .where("payment_id", "in", paymentIds)
                .pipe(Effect.head),
            );
            totalAllocatedCents = Number(allocResult.total);
          }

          const outstandingCents = Math.max(0, grossOutstandingCents - totalAllocatedCents);

          const now = new Date();
          const overdueBills = issuedBills.filter(
            (b) => b.status === "issued" && b.due_date && new Date(b.due_date) < now,
          );
          const overdueCents = overdueBills.reduce((s, b) => s + b.total_cents, 0);

          let refundTotal = 0;
          if (paymentIds.length > 0) {
            const refundResult = yield* withAuthContext(sessionId, (db: AuthDB) =>
              db
                .selectFrom("app_public.refunds")
                .select(sql<number>`COALESCE(SUM(amount_cents), 0)`.as("total"))
                .where("payment_id", "in", paymentIds)
                .pipe(Effect.head),
            );
            refundTotal = Number(refundResult.total);
          }

          const activeCredits = credits
            .filter((c) => c.consumed_at === null)
            .reduce((s, c) => s + c.amount_cents, 0);
          const payTotal = payments.reduce((s, p) => s + p.amount_cents, 0);
          const paymentsNet = payTotal - refundTotal;
          const materializedCreditTotal = credits
            .filter((c) => c.source_payment_id !== null)
            .reduce((s, c) => s + c.amount_cents, 0);
          const unallocatedPayments = paymentsNet - totalAllocatedCents - materializedCreditTotal;

          return {
            family_id: family.id,
            family_name: family.name,
            balance: {
              outstanding_cents: outstandingCents,
              overdue_cents: overdueCents,
              credit_balance_cents: activeCredits + Math.max(0, unallocatedPayments),
            },
            bills,
            payments,
            credits,
          };
        }),
      };
    }),
  },
) {}
