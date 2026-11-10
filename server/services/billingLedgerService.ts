import { Effect, Option, Context, Layer } from "effect";
import { sql } from "kysely";
import { type Database, withAuthContext } from "../db.js";
import { catchPgErrors, HttpError } from "../pgErrors.js";
import { allocatePayment } from "./billingCalculation.js";
import { isFirstOfMonth } from "./recurringScheduleService.js";

export interface CreateBillInput {
  payerId: string;
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
  payerId: string;
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
  payerId: string;
  studentId?: string | null;
  amountCents: number;
  reason: string;
  expiresAt?: string | null;
}

export interface VoidBillInput {
  billId: string;
  reason: string;
}

export interface PayerBalance {
  outstandingCents: number;
  creditBalanceCents: number;
  overdueCents: number;
}

export interface DiscountInput {
  payerId: string;
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

export interface TaxExemptionInput {
  payerId: string;
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

export class CrossPayerError extends HttpError {
  constructor() {
    super(409, "Cannot allocate across different payers");
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

export class BillingLedgerService extends Context.Service<BillingLedgerService>()(
  "BillingLedgerService",
  {
    make: Effect.gen(function* () {
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
            Effect.fnUntraced(function* (db: Database) {
              const billNumber = yield* db
                .execute(
                  db
                    .selectFrom(
                      db
                        .selectNoFrom(() => sql<number>`app_public.next_bill_number()`.as("n"))
                        .as("t"),
                    )
                    .select(sql<number>`t.n`.as("n")),
                )
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.n),
                );

              const b = yield* db
                .execute(
                  db
                    .insertInto("app_public.bills")
                    .values({
                      payer_id: input.payerId,
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
                      "payer_id",
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
                    ]),
                )
                .pipe(Effect.head, catchPgErrors);

              if (input.lineItems.length > 0) {
                yield* db
                  .execute(
                    db.insertInto("app_public.bill_line_items").values(
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
                    ),
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
            Effect.fnUntraced(function* (db: Database) {
              const issued = yield* db
                .execute(
                  db
                    .updateTable("app_public.bills")
                    .set({ status: "issued", issued_at: sql`now()` })
                    .where("id", "=", billId)
                    .where("status", "=", "draft")
                    .returningAll(),
                )
                .pipe(Effect.head, Effect.option);

              if (Option.isSome(issued)) {
                return issued.value;
              }

              const existing = yield* db
                .execute(
                  db
                    .selectFrom("app_public.bills")
                    .select((eb) => [
                      "status",
                      eb.fn("app_public.current_user_id").as("current_user_id"),
                      eb.fn("app_public.current_user_role").as("current_user_role"),
                    ])
                    .where("id", "=", billId),
                )
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
          const bill = yield* withAuthContext(sessionId, (db: Database) =>
            db
              .execute(db.selectFrom("app_public.bills").selectAll().where("id", "=", billId))
              .pipe(Effect.head, Effect.option),
          );
          if (Option.isNone(bill)) {
            return null;
          }

          const lineItems = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db
                .selectFrom("app_public.bill_line_items")
                .selectAll()
                .where("bill_id", "=", billId)
                .orderBy("created_at"),
            ),
          );

          const adjustments = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db
                .selectFrom("app_public.bill_adjustments")
                .selectAll()
                .where("bill_id", "=", billId)
                .orderBy("created_at"),
            ),
          );

          const creditApplications = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db
                .selectFrom("app_public.credit_applications")
                .selectAll()
                .where("bill_id", "=", billId)
                .orderBy("created_at"),
            ),
          );

          return { ...bill.value, lineItems, adjustments, creditApplications };
        }),

        billLineItems: Effect.fn("billLineItems")(function* (sessionId: string, billId: string) {
          const items = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db
                .selectFrom("app_public.bill_line_items")
                .selectAll()
                .where("bill_id", "=", billId)
                .orderBy("created_at"),
            ),
          );
          return items;
        }),

        listPayerBills: Effect.fn("listPayerBills")(function* (sessionId: string, payerId: string) {
          const bills = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db
                .selectFrom("app_public.bills")
                .selectAll()
                .where("payer_id", "=", payerId)
                .orderBy("created_at", "desc"),
            ),
          );
          return bills;
        }),

        // Single-booking bills for lessons in the month, newest lesson last. Cancelled
        // and voided bills are left out: nobody owes them.
        listLessonBills: Effect.fn("listLessonBills")(function* (
          sessionId: string,
          billingMonth: string,
        ) {
          if (!isFirstOfMonth(billingMonth)) {
            return yield* new HttpError(400, "month must be the first day of a month (YYYY-MM-01)");
          }
          const rows = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db
                .selectFrom("app_public.bills as b")
                .innerJoin("app_public.bill_line_items as bli", "bli.bill_id", "b.id")
                .innerJoin("app_public.lessons as l", "l.id", "bli.lesson_id")
                .innerJoin("app_public.users as s", "s.id", "l.student_id")
                .innerJoin("app_public.users as p", "p.id", "b.payer_id")
                .select([
                  "b.id as bill_id",
                  "b.bill_number",
                  "b.status",
                  "b.total_cents",
                  "b.payer_id",
                  sql<string>`coalesce(p.name, p.username::text)`.as("payer_name"),
                  "l.id as lesson_id",
                  "l.scheduled_at",
                  "s.id as student_id",
                  sql<string>`coalesce(s.name, s.username::text)`.as("student_name"),
                  ...billBalanceColumns,
                ])
                .where("b.status", "in", ["issued", "paid"])
                .where("b.billing_period_start", ">=", sql<Date>`${billingMonth}::date`)
                .where(
                  "b.billing_period_start",
                  "<",
                  sql<Date>`(${billingMonth}::date + interval '1 month')::date`,
                )
                .orderBy("l.scheduled_at", "asc"),
            ),
          );
          return rows.map(({ adjustments, credits, payments, ...row }) => ({
            ...row,
            outstanding_cents: Math.max(
              0,
              row.total_cents + Number(adjustments) - Number(credits) - Number(payments),
            ),
          }));
        }),

        voidBill: Effect.fn("voidBill")(function* (sessionId: string, input: VoidBillInput) {
          const result = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: Database) {
              const bill = yield* db
                .execute(
                  db
                    .selectFrom("app_public.bills")
                    .select(["id", "status", "payer_id"])
                    .where("id", "=", input.billId),
                )
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
                .execute(
                  db
                    .updateTable("app_public.bills")
                    .set({
                      status: "void",
                      voided_at: sql`now()`,
                      notes: sql<string>`case when notes is null or notes = '' then ${input.reason} else notes || E'\\nVoid reason: ' || ${input.reason} end`,
                    })
                    .where("id", "=", input.billId)
                    .returningAll(),
                )
                .pipe(Effect.head, catchPgErrors);
            }),
          );
          return result;
        }),

        cancelBill: Effect.fn("cancelBill")(function* (sessionId: string, billId: string) {
          const result = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: Database) {
              const cancelled = yield* db
                .execute(
                  db
                    .updateTable("app_public.bills")
                    .set({ status: "cancelled", cancelled_at: sql`now()` })
                    .where("id", "=", billId)
                    .where("status", "=", "draft")
                    .returningAll(),
                )
                .pipe(Effect.head, Effect.option);

              if (Option.isSome(cancelled)) {
                return cancelled.value;
              }

              const existing = yield* db
                .execute(
                  db.selectFrom("app_public.bills").select("status").where("id", "=", billId),
                )
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
            Effect.fnUntraced(function* (db: Database) {
              const bills = yield* db.execute(
                db
                  .selectFrom("app_public.bills as b")
                  .select([
                    "b.id",
                    "b.total_cents",
                    "b.due_date",
                    "b.status",
                    ...billBalanceColumns,
                  ])
                  .where("b.payer_id", "=", input.payerId)
                  .where("b.status", "in", ["issued", "paid"])
                  .orderBy("b.due_date", "asc")
                  .orderBy("b.created_at", "asc"),
              );

              // Explicit allocations may name any bill, so check each one here with
              // typed errors before the allocator, which assumes the payer's open bills.
              const requestedByBill = new Map<string, number>();
              for (const a of input.allocations) {
                requestedByBill.set(a.billId, (requestedByBill.get(a.billId) ?? 0) + a.amountCents);
              }
              for (const [billId, requested] of requestedByBill) {
                const bill = yield* db
                  .execute(
                    db
                      .selectFrom("app_public.bills as b")
                      .select(["b.payer_id", "b.status", "b.total_cents", ...billBalanceColumns])
                      .where("id", "=", billId),
                  )
                  .pipe(Effect.head, Effect.option);
                if (Option.isNone(bill)) {
                  return yield* new BillNotFoundError();
                }
                if (bill.value.payer_id !== input.payerId) {
                  return yield* new CrossPayerError();
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
                if (requested > outstanding) {
                  return yield* new InvalidStateError(
                    `Allocation exceeds bill outstanding balance (${outstanding})`,
                  );
                }
              }

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

              const paymentNumber = yield* db
                .execute(
                  db
                    .selectFrom(
                      db
                        .selectNoFrom(() => sql<number>`app_public.next_payment_number()`.as("n"))
                        .as("t"),
                    )
                    .select(sql<number>`t.n`.as("n")),
                )
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.n),
                );

              const p = yield* db
                .execute(
                  db
                    .insertInto("app_public.payments")
                    .values({
                      payer_id: input.payerId,
                      payment_number: paymentNumber,
                      amount_cents: input.amountCents,
                      method: input.method,
                      reference: input.reference ?? null,
                      received_at: input.receivedAt ?? new Date(),
                      notes: input.notes ?? null,
                    })
                    .returningAll(),
                )
                .pipe(Effect.head, catchPgErrors);

              if (allocations.length > 0) {
                yield* db
                  .execute(
                    db.insertInto("app_public.payment_allocations").values(
                      allocations.map((a) => ({
                        payment_id: p.id,
                        bill_id: a.billId,
                        amount_cents: a.amountCents,
                      })),
                    ),
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
                  .execute(
                    db.insertInto("app_public.credits").values({
                      payer_id: input.payerId,
                      student_id: null,
                      amount_cents: excessCents,
                      reason: `Excess payment credit from payment ${p.payment_number}`,
                      created_by: sql<string>`app_public.current_user_id()`,
                      source_payment_id: p.id,
                      expires_at: null,
                      consumed_at: null,
                    }),
                  )
                  .pipe(catchPgErrors);
              }

              for (const billId of requestedByBill.keys()) {
                const balance = yield* db
                  .execute(
                    db
                      .selectFrom("app_public.bills as b")
                      .select(["b.total_cents", "b.status", ...billBalanceColumns])
                      .where("b.id", "=", billId),
                  )
                  .pipe(Effect.head);
                const outstanding =
                  balance.total_cents +
                  Number(balance.adjustments) -
                  Number(balance.credits) -
                  Number(balance.payments);
                if (outstanding <= 0 && balance.status === "issued") {
                  yield* db
                    .execute(
                      db
                        .updateTable("app_public.bills")
                        .set({ status: "paid", paid_at: sql`now()` })
                        .where("id", "=", billId)
                        .returning("id"),
                    )
                    .pipe(Effect.head);
                }
              }

              return p;
            }),
          );

          return payment;
        }),

        listPayerPayments: Effect.fn("listPayerPayments")(function* (
          sessionId: string,
          payerId: string,
        ) {
          const payments = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db
                .selectFrom("app_public.payments")
                .selectAll()
                .where("payer_id", "=", payerId)
                .orderBy("received_at", "desc"),
            ),
          );
          return payments;
        }),

        applyCredit: Effect.fn("applyCredit")(function* (
          sessionId: string,
          input: ApplyCreditInput,
        ) {
          const app = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: Database) {
              if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
                return yield* new ValidationError(
                  "Credit application must be a positive number of cents",
                );
              }
              const bill = yield* db
                .execute(
                  db
                    .selectFrom("app_public.bills")
                    .select([
                      "payer_id",
                      "status",
                      "total_cents",
                      sql<number>`coalesce((select sum(amount_cents) from app_public.bill_adjustments where bill_id = app_public.bills.id), 0)`.as(
                        "adjustments",
                      ),
                      sql<number>`coalesce((select sum(amount_cents) from app_public.credit_applications where bill_id = app_public.bills.id), 0)`.as(
                        "credits",
                      ),
                      sql<number>`coalesce((select sum(amount_cents) from app_public.payment_allocations where bill_id = app_public.bills.id), 0)`.as(
                        "payments",
                      ),
                    ])
                    .where("id", "=", input.billId),
                )
                .pipe(Effect.head, Effect.option);
              if (Option.isNone(bill)) {
                return yield* new BillNotFoundError();
              }
              if (bill.value.status !== "issued" && bill.value.status !== "paid") {
                return yield* new InvalidStateError("Credits can only be applied to issued bills");
              }

              const credit = yield* db
                .execute(
                  db
                    .selectFrom("app_public.credits")
                    .selectAll()
                    .where("id", "=", input.creditId)
                    .forUpdate(),
                )
                .pipe(Effect.head, Effect.option);
              if (Option.isNone(credit)) {
                return yield* new CreditNotFoundError();
              }
              if (credit.value.consumed_at !== null) {
                return yield* new InvalidStateError("Credit has already been fully consumed");
              }
              if (credit.value.payer_id !== bill.value.payer_id) {
                return yield* new CrossPayerError();
              }

              const alreadyApplied = yield* db
                .execute(
                  db
                    .selectFrom("app_public.credit_applications")
                    .select(sql<number>`COALESCE(SUM(amount_cents), 0)`.as("total_applied"))
                    .where("credit_id", "=", input.creditId),
                )
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
                .execute(
                  db
                    .insertInto("app_public.credit_applications")
                    .values({
                      credit_id: input.creditId,
                      bill_id: input.billId,
                      amount_cents: input.amountCents,
                    })
                    .returningAll(),
                )
                .pipe(Effect.head, catchPgErrors);
              if (outstanding - input.amountCents <= 0 && bill.value.status === "issued") {
                yield* db
                  .execute(
                    db
                      .updateTable("app_public.bills")
                      .set({ status: "paid", paid_at: sql`now()` })
                      .where("id", "=", input.billId)
                      .returning("id"),
                  )
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
            Effect.fnUntraced(function* (db: Database) {
              const bill = yield* db
                .execute(
                  db
                    .selectFrom("app_public.bills")
                    .select(["id", "status"])
                    .where("id", "=", input.billId),
                )
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
                .execute(
                  db
                    .selectFrom(
                      db
                        .selectNoFrom(() => sql<string>`app_public.current_user_id()`.as("uid"))
                        .as("t"),
                    )
                    .select(sql<string>`t.uid`.as("user_id")),
                )
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.user_id),
                );

              return yield* db
                .execute(
                  db
                    .insertInto("app_public.bill_adjustments")
                    .values({
                      bill_id: input.billId,
                      amount_cents: input.amountCents,
                      reason: input.reason,
                      created_by: userId,
                    })
                    .returningAll(),
                )
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
            Effect.fnUntraced(function* (db: Database) {
              const payment = yield* db
                .execute(
                  db
                    .selectFrom("app_public.payments")
                    .selectAll()
                    .where("id", "=", input.paymentId),
                )
                .pipe(Effect.head, Effect.option);
              if (Option.isNone(payment)) {
                return yield* new PaymentNotFoundError();
              }

              const totalRefunded = yield* db
                .execute(
                  db
                    .selectFrom("app_public.refunds")
                    .select(sql<number>`COALESCE(SUM(amount_cents), 0)`.as("total_refunded"))
                    .where("payment_id", "=", input.paymentId)
                    .where("reversed_at", "is", null),
                )
                .pipe(
                  Effect.head,
                  Effect.map((r) => Number(r.total_refunded)),
                );

              const remaining = payment.value.amount_cents - totalRefunded;
              if (input.amountCents > remaining) {
                return yield* new RefundExceedsPaymentError();
              }

              const userId = yield* db
                .execute(
                  db
                    .selectFrom(
                      db
                        .selectNoFrom(() => sql<string>`app_public.current_user_id()`.as("uid"))
                        .as("t"),
                    )
                    .select(sql<string>`t.uid`.as("user_id")),
                )
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.user_id),
                );

              return yield* db
                .execute(
                  db
                    .insertInto("app_public.refunds")
                    .values({
                      payment_id: input.paymentId,
                      amount_cents: input.amountCents,
                      reason: input.reason,
                      created_by: userId,
                      refunded_at: sql`now()`,
                      notes: input.notes ?? null,
                    })
                    .returningAll(),
                )
                .pipe(Effect.head, catchPgErrors);
            }),
          );

          return refund;
        }),

        listPayerCredits: Effect.fn("listPayerCredits")(function* (
          sessionId: string,
          payerId: string,
        ) {
          const credits = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db
                .selectFrom("app_public.credits")
                .selectAll()
                .where("payer_id", "=", payerId)
                .orderBy("created_at", "desc"),
            ),
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
            Effect.fnUntraced(function* (db: Database) {
              const userId = yield* db
                .execute(
                  db
                    .selectFrom(
                      db
                        .selectNoFrom(() => sql<string>`app_public.current_user_id()`.as("uid"))
                        .as("t"),
                    )
                    .select(sql<string>`t.uid`.as("user_id")),
                )
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.user_id),
                );

              return yield* db
                .execute(
                  db
                    .insertInto("app_public.credits")
                    .values({
                      payer_id: input.payerId,
                      student_id: input.studentId ?? null,
                      amount_cents: input.amountCents,
                      reason: input.reason,
                      created_by: userId,
                      expires_at: input.expiresAt ?? null,
                    })
                    .returningAll(),
                )
                .pipe(Effect.head, catchPgErrors);
            }),
          );

          return credit;
        }),

        getPayerBalance: Effect.fn("getPayerBalance")(function* (
          sessionId: string,
          payerId: string,
        ) {
          const bills = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db
                .selectFrom("app_public.bills")
                .select(["id", "status", "total_cents", "due_date"])
                .where("payer_id", "=", payerId),
            ),
          );

          const billIds = bills.map((b) => b.id);
          const adjustments = billIds.length
            ? yield* withAuthContext(sessionId, (db: Database) =>
                db.execute(
                  db
                    .selectFrom("app_public.bill_adjustments")
                    .select(["bill_id", "amount_cents"])
                    .where("bill_id", "in", billIds),
                ),
              )
            : [];
          const creditApplications = billIds.length
            ? yield* withAuthContext(sessionId, (db: Database) =>
                db.execute(
                  db
                    .selectFrom("app_public.credit_applications")
                    .select(["bill_id", "amount_cents"])
                    .where("bill_id", "in", billIds),
                ),
              )
            : [];

          const payments = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db
                .selectFrom("app_public.payments")
                .select(["id", "amount_cents"])
                .where("payer_id", "=", payerId),
            ),
          );

          const paymentIds = payments.map((p) => p.id);

          const allocations = paymentIds.length
            ? yield* withAuthContext(sessionId, (db: Database) =>
                db.execute(
                  db
                    .selectFrom("app_public.payment_allocations")
                    .select(["payment_id", "bill_id", "amount_cents"])
                    .where("payment_id", "in", paymentIds),
                ),
              )
            : [];
          const refunds = paymentIds.length
            ? yield* withAuthContext(sessionId, (db: Database) =>
                db.execute(
                  db
                    .selectFrom("app_public.refunds")
                    .select(["payment_id", "amount_cents"])
                    .where("payment_id", "in", paymentIds)
                    .where("reversed_at", "is", null),
                ),
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

          const credits = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db
                .selectFrom("app_public.credits as c")
                .leftJoin("app_public.credit_applications as ca", "ca.credit_id", "c.id")
                .select(["c.id", "c.amount_cents", "c.expires_at", "c.source_payment_id"])
                .select(sql<number>`coalesce(sum(ca.amount_cents), 0)`.as("applied_cents"))
                .where("c.payer_id", "=", payerId)
                .groupBy(["c.id", "c.amount_cents", "c.expires_at"]),
            ),
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
          input: DiscountInput,
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
            Effect.fnUntraced(function* (db: Database) {
              const userId = yield* db
                .execute(
                  db
                    .selectFrom(
                      db
                        .selectNoFrom(() => sql<string>`app_public.current_user_id()`.as("uid"))
                        .as("t"),
                    )
                    .select(sql<string>`t.uid`.as("user_id")),
                )
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.user_id),
                );

              return yield* db
                .execute(
                  db
                    .insertInto("app_public.discounts")
                    .values({
                      payer_id: input.payerId,
                      label: input.label,
                      discount_type: input.discountType,
                      discount_value: input.discountValue,
                      applies_to: input.appliesTo,
                      effective_from: input.effectiveFrom,
                      effective_until: input.effectiveUntil ?? null,
                      created_by: userId,
                    })
                    .returningAll(),
                )
                .pipe(Effect.head, catchPgErrors);
            }),
          );
          return discount;
        }),

        updateDiscount: Effect.fn("updateDiscount")(function* (
          sessionId: string,
          discountId: string,
          input: Partial<DiscountInput>,
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
            Effect.fnUntraced(function* (db: Database) {
              return yield* db
                .execute(
                  db
                    .updateTable("app_public.discounts")
                    .set(updates)
                    .where("id", "=", discountId)
                    .returningAll(),
                )
                .pipe(Effect.head, catchPgErrors);
            }),
          );
          return discount;
        }),

        listPayerDiscounts: Effect.fn("listPayerDiscounts")(function* (
          sessionId: string,
          payerId: string,
        ) {
          const discounts = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db
                .selectFrom("app_public.discounts")
                .selectAll()
                .where("payer_id", "=", payerId)
                .orderBy("effective_from", "desc"),
            ),
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
            Effect.fnUntraced(function* (db: Database) {
              const userId = yield* db
                .execute(
                  db
                    .selectFrom(
                      db
                        .selectNoFrom(() => sql<string>`app_public.current_user_id()`.as("uid"))
                        .as("t"),
                    )
                    .select(sql<string>`t.uid`.as("user_id")),
                )
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.user_id),
                );

              return yield* db
                .execute(
                  db
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
                    .returningAll(),
                )
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
            Effect.fnUntraced(function* (db: Database) {
              return yield* db
                .execute(
                  db
                    .updateTable("app_public.tax_rates")
                    .set(updates)
                    .where("id", "=", taxRateId)
                    .returningAll(),
                )
                .pipe(Effect.head, catchPgErrors);
            }),
          );
          return rate;
        }),

        listTaxRates: Effect.fn("listTaxRates")(function* (sessionId: string) {
          const rates = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db.selectFrom("app_public.tax_rates").selectAll().orderBy("effective_from", "desc"),
            ),
          );
          return rates;
        }),

        createTaxExemption: Effect.fn("createTaxExemption")(function* (
          sessionId: string,
          input: TaxExemptionInput,
        ) {
          const exemption = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db: Database) {
              const userId = yield* db
                .execute(
                  db
                    .selectFrom(
                      db
                        .selectNoFrom(() => sql<string>`app_public.current_user_id()`.as("uid"))
                        .as("t"),
                    )
                    .select(sql<string>`t.uid`.as("user_id")),
                )
                .pipe(
                  Effect.head,
                  Effect.map((r) => r.user_id),
                );

              return yield* db
                .execute(
                  db
                    .insertInto("app_public.tax_exemptions")
                    .values({
                      payer_id: input.payerId,
                      tax_rate_id: input.taxRateId,
                      exemption_reason: input.exemptionReason,
                      effective_from: input.effectiveFrom,
                      effective_until: input.effectiveUntil ?? null,
                      created_by: userId,
                    })
                    .returningAll(),
                )
                .pipe(Effect.head, catchPgErrors);
            }),
          );
          return exemption;
        }),

        listPayerTaxExemptions: Effect.fn("listPayerTaxExemptions")(function* (
          sessionId: string,
          payerId: string,
        ) {
          const exemptions = yield* withAuthContext(sessionId, (db: Database) =>
            db.execute(
              db
                .selectFrom("app_public.tax_exemptions")
                .selectAll()
                .where("payer_id", "=", payerId)
                .orderBy("effective_from", "desc"),
            ),
          );
          return exemptions;
        }),

        listPayers: Effect.fn("listPayers")(function* (sessionId: string) {
          // A payer is anyone who pays for a student, plus anyone who still holds
          // ledger rows after a family change moved their students elsewhere. Users
          // of other roles pay for their own lessons but are listed only once billed.
          const [payers, studentRows] = yield* withAuthContext(sessionId, (db: Database) =>
            Effect.all([
              db.execute(
                db
                  .selectFrom("app_public.users as u")
                  .select(["u.id", sql<string>`coalesce(u.name, u.username)`.as("name")])
                  .where((eb) =>
                    eb.or([
                      eb(
                        "u.id",
                        "in",
                        eb
                          .selectFrom("app_public.student_payers as sp")
                          .innerJoin("app_public.users as s", "s.id", "sp.student_id")
                          .where("s.role", "=", "student")
                          .select("sp.payer_id"),
                      ),
                      eb("u.id", "in", eb.selectFrom("app_public.bills").select("payer_id")),
                      eb("u.id", "in", eb.selectFrom("app_public.payments").select("payer_id")),
                      eb("u.id", "in", eb.selectFrom("app_public.credits").select("payer_id")),
                    ]),
                  )
                  .orderBy("name"),
              ),
              db.execute(
                db
                  .selectFrom("app_public.student_payers as sp")
                  .innerJoin("app_public.users as u", "u.id", "sp.student_id")
                  .where("u.role", "=", "student")
                  .select([
                    "sp.payer_id",
                    "u.id",
                    sql<string>`coalesce(u.name, u.username)`.as("name"),
                  ])
                  .orderBy("name"),
              ),
            ]),
          );

          const studentsByPayer = new Map<string, Array<{ id: string; name: string }>>();
          for (const { payer_id, id, name } of studentRows) {
            if (payer_id === null) continue;
            const arr = studentsByPayer.get(payer_id);
            if (arr) arr.push({ id, name });
            else studentsByPayer.set(payer_id, [{ id, name }]);
          }

          const [allBills, allPayments, allCredits] = yield* Effect.all([
            withAuthContext(sessionId, (db: Database) =>
              db.execute(db.selectFrom("app_public.bills").selectAll()),
            ),
            withAuthContext(sessionId, (db: Database) =>
              db.execute(db.selectFrom("app_public.payments").selectAll()),
            ),
            withAuthContext(sessionId, (db: Database) =>
              db.execute(db.selectFrom("app_public.credits").selectAll()),
            ),
          ]);

          const payMap = new Map<string, Array<(typeof allPayments)[number]>>();
          for (const p of allPayments) {
            const arr = payMap.get(p.payer_id);
            if (arr) arr.push(p);
            else payMap.set(p.payer_id, [p]);
          }

          const billMap = new Map<string, Array<(typeof allBills)[number]>>();
          for (const b of allBills) {
            const arr = billMap.get(b.payer_id);
            if (arr) arr.push(b);
            else billMap.set(b.payer_id, [b]);
          }

          const creditMap = new Map<string, Array<(typeof allCredits)[number]>>();
          for (const c of allCredits) {
            const arr = creditMap.get(c.payer_id);
            if (arr) arr.push(c);
            else creditMap.set(c.payer_id, [c]);
          }

          const allPaymentIds = allPayments.map((p) => p.id);
          let allocSumByPayment: Map<string, number> | undefined;
          if (allPaymentIds.length > 0) {
            const allocRows = yield* withAuthContext(sessionId, (db: Database) =>
              db.execute(
                db
                  .selectFrom("app_public.payment_allocations")
                  .select(["payment_id", "amount_cents"])
                  .where("payment_id", "in", allPaymentIds),
              ),
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
            const billPaidRows = yield* withAuthContext(sessionId, (db: Database) =>
              db.execute(
                db
                  .selectFrom("app_public.payment_allocations")
                  .select(["bill_id", "amount_cents"])
                  .where("payment_id", "in", allPaymentIds),
              ),
            );
            for (const a of billPaidRows) {
              unpaidAllocByBill.set(
                a.bill_id,
                (unpaidAllocByBill.get(a.bill_id) ?? 0) + a.amount_cents,
              );
            }
          }

          const summaries: Array<{
            payer_id: string;
            payer_name: string;
            students: Array<{ id: string; name: string }>;
            bill_count: number;
            total_billed_cents: number;
            total_paid_cents: number;
            outstanding_cents: number;
            overdue_cents: number;
            credit_balance_cents: number;
          }> = [];

          for (const payer of payers) {
            const payerBills = billMap.get(payer.id) ?? [];
            const payerPayments = payMap.get(payer.id) ?? [];
            const payerCredits = creditMap.get(payer.id) ?? [];

            const issuedBills = payerBills.filter(
              (b) => b.status === "issued" || b.status === "paid",
            );
            const totalBilledCents = issuedBills.reduce((s, b) => s + b.total_cents, 0);

            let totalPaidCents = 0;
            for (const p of payerPayments) {
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

            const activeCredits = payerCredits
              .filter((c) => c.consumed_at === null)
              .reduce((s, c) => s + c.amount_cents, 0);

            const payTotal = payerPayments.reduce((s, p) => s + p.amount_cents, 0);
            const materializedCreditTotal = payerCredits
              .filter((c) => c.source_payment_id !== null)
              .reduce((s, c) => s + c.amount_cents, 0);
            const unallocatedPayments = payTotal - totalPaidCents - materializedCreditTotal;
            summaries.push({
              payer_id: payer.id,
              payer_name: payer.name,
              students: studentsByPayer.get(payer.id) ?? [],
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

        getPayerBillingDetail: Effect.fn("getPayerBillingDetail")(function* (
          sessionId: string,
          payerId: string,
        ) {
          const payer = yield* withAuthContext(sessionId, (db: Database) => getPayer(db, payerId));

          const [bills, payments, credits] = yield* Effect.all([
            withAuthContext(sessionId, (db: Database) =>
              db.execute(
                db
                  .selectFrom("app_public.bills")
                  .selectAll()
                  .where("payer_id", "=", payerId)
                  .orderBy("created_at", "desc"),
              ),
            ),
            withAuthContext(sessionId, (db: Database) =>
              db.execute(
                db
                  .selectFrom("app_public.payments")
                  .selectAll()
                  .where("payer_id", "=", payerId)
                  .orderBy("received_at", "desc"),
              ),
            ),
            withAuthContext(sessionId, (db: Database) =>
              db.execute(
                db
                  .selectFrom("app_public.credits")
                  .selectAll()
                  .where("payer_id", "=", payerId)
                  .orderBy("created_at", "desc"),
              ),
            ),
          ]);

          const issuedBills = bills.filter((b) => b.status === "issued" || b.status === "paid");
          const grossOutstandingCents = issuedBills.reduce((s, b) => s + b.total_cents, 0);

          const paymentIds = payments.map((p) => p.id);
          let totalAllocatedCents = 0;
          if (paymentIds.length > 0) {
            const allocResult = yield* withAuthContext(sessionId, (db: Database) =>
              db
                .execute(
                  db
                    .selectFrom("app_public.payment_allocations")
                    .select(sql<number>`COALESCE(SUM(amount_cents), 0)`.as("total"))
                    .where("payment_id", "in", paymentIds),
                )
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
            const refundResult = yield* withAuthContext(sessionId, (db: Database) =>
              db
                .execute(
                  db
                    .selectFrom("app_public.refunds")
                    .select(sql<number>`COALESCE(SUM(amount_cents), 0)`.as("total"))
                    .where("payment_id", "in", paymentIds),
                )
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
            payer_id: payer.id,
            payer_name: payer.name,
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
) {
  static readonly layer = Layer.effect(this, this.make);
}

/** The payer's id and display name. Fails with a 404 when RLS hides the user. */
export function getPayer(db: Database, payerId: string) {
  return db
    .execute(
      db
        .selectFrom("app_public.users")
        .select(["id", sql<string>`coalesce(name, username)`.as("name")])
        .where("id", "=", payerId),
    )
    .pipe(
      Effect.head,
      Effect.catchTags({
        NoSuchElementError: () => new HttpError(404, "Payer not found"),
      }),
    );
}

/**
 * The sums that move a bill's balance, for a query that aliases bills as `b`.
 * Outstanding = total_cents + adjustments - credits - payments.
 */
const billBalanceColumns = [
  sql<number>`coalesce((select sum(amount_cents) from app_public.bill_adjustments where bill_id = b.id), 0)`.as(
    "adjustments",
  ),
  sql<number>`coalesce((select sum(amount_cents) from app_public.credit_applications where bill_id = b.id), 0)`.as(
    "credits",
  ),
  sql<number>`coalesce((select sum(amount_cents) from app_public.payment_allocations where bill_id = b.id), 0)`.as(
    "payments",
  ),
];
