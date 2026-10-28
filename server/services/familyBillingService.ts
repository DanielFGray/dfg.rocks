import { Effect, Option } from "effect";
import type { EffectKysely } from "@effect/sql-kysely/Kysely";
import type { DB } from "../../generated/db.js";
import { withAuthContext } from "../db.js";
import { HttpError } from "../pgErrors.js";
import { PdfService } from "./pdfService.js";
import { BillingLedgerService } from "./billingLedgerService.js";

type AuthDB = EffectKysely<DB>;

export class FamilyBillingService extends Effect.Service<FamilyBillingService>()(
  "FamilyBillingService",
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const pdf = yield* PdfService;
      const ledger = yield* BillingLedgerService;

      function getFamilyId(sessionId: string, userId: string) {
        return withAuthContext(sessionId, (db: AuthDB) =>
          db
            .selectFrom("app_public.family_memberships")
            .select("family_id")
            .where("user_id", "=", userId)
            .pipe(Effect.head, Effect.map((r) => r.family_id)),
        );
      }

      function getFamily(sessionId: string, familyId: string) {
        return withAuthContext(sessionId, (db: AuthDB) =>
          db
            .selectFrom("app_public.families")
            .select(["id", "name"])
            .where("id", "=", familyId)
            .pipe(Effect.head),
        );
      }

      return {
        overview: Effect.fn("overview")(function* (sessionId: string, userId: string) {
          const familyId = yield* getFamilyId(sessionId, userId);

          const family = yield* getFamily(sessionId, familyId);

          const bills = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.bills")
              .selectAll()
              .where("family_id", "=", familyId)
              .orderBy("created_at", "desc"),
          );

          const payments = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.payments")
              .selectAll()
              .where("family_id", "=", familyId)
              .orderBy("received_at", "desc"),
          );

          const credits = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.family_credits")
              .selectAll()
              .where("family_id", "=", familyId)
              .orderBy("created_at", "desc"),
          );

          const ledgerBalance = yield* ledger.getFamilyBalance(sessionId, familyId);
          const grossOutstandingCents = bills
            .filter((b) => b.status === "issued" || b.status === "paid")
            .reduce((sum, b) => sum + b.total_cents, 0);

          const now = new Date();
          const overdueBills = bills.filter(
            (b) =>
              (b.status === "issued") &&
              b.due_date &&
              new Date(b.due_date) < now,
          );
          const overdueCents = ledgerBalance.overdueCents;

          const openBills = bills.filter(
            (b) => b.status === "issued" || b.status === "draft",
          );
          const overdueBillsList = overdueBills;

          const recentPayments = payments.slice(0, 10);

          return {
            family_id: familyId,
            family_name: family.name,
            balance: {
              outstanding_cents: ledgerBalance.outstandingCents,
              credit_balance_cents: ledgerBalance.creditBalanceCents,
              available_credit_cents: ledgerBalance.creditBalanceCents,
              overdue_cents: overdueCents,
              gross_outstanding_cents: grossOutstandingCents,
              net_due_cents: Math.max(0, ledgerBalance.outstandingCents - ledgerBalance.creditBalanceCents),
            },
            open_bills: openBills,
            overdue_bills: overdueBillsList,
            recent_payments: recentPayments,
            credits: credits,
          };
        }),

        bills: Effect.fn("bills")(function* (sessionId: string, userId: string) {
          const familyId = yield* getFamilyId(sessionId, userId);
          return yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.bills")
              .selectAll()
              .where("family_id", "=", familyId)
              .orderBy("created_at", "desc"),
          );
        }),

        billDetail: Effect.fn("billDetail")(function* (
          sessionId: string,
          userId: string,
          billId: string,
        ) {
          const bill = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.bills")
              .selectAll()
              .where("id", "=", billId)
              .pipe(Effect.head, Effect.option),
          );
          if (Option.isNone(bill)) {
            return yield* new HttpError(404, "Bill not found");
          }

          const familyId = yield* getFamilyId(sessionId, userId);
          if (bill.value.family_id !== familyId) {
            return yield* new HttpError(403, "Forbidden");
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

        payments: Effect.fn("payments")(function* (sessionId: string, userId: string) {
          const familyId = yield* getFamilyId(sessionId, userId);
          return yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.payments")
              .selectAll()
              .where("family_id", "=", familyId)
              .orderBy("received_at", "desc"),
          );
        }),

        paymentDetail: Effect.fn("paymentDetail")(function* (
          sessionId: string,
          userId: string,
          paymentId: string,
        ) {
          const payment = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.payments")
              .selectAll()
              .where("id", "=", paymentId)
              .pipe(Effect.head, Effect.option),
          );
          if (Option.isNone(payment)) {
            return yield* new HttpError(404, "Payment not found");
          }

          const familyId = yield* getFamilyId(sessionId, userId);
          if (payment.value.family_id !== familyId) {
            return yield* new HttpError(403, "Forbidden");
          }

          const allocations = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.payment_allocations as pa")
              .innerJoin("app_public.bills as b", "b.id", "pa.bill_id")
              .select([
                "pa.id",
                "pa.payment_id",
                "pa.bill_id",
                "b.bill_number",
                "pa.amount_cents",
                "pa.created_at",
              ])
              .where("pa.payment_id", "=", paymentId)
              .orderBy("pa.created_at"),
          );

          return {
            ...payment.value,
            allocations,
          };
        }),

        credits: Effect.fn("credits")(function* (sessionId: string, userId: string) {
          const familyId = yield* getFamilyId(sessionId, userId);
          return yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.family_credits")
              .selectAll()
              .where("family_id", "=", familyId)
              .orderBy("created_at", "desc"),
          );
        }),

        billPdf: Effect.fn("billPdf")(function* (
          sessionId: string,
          userId: string,
          billId: string,
        ) {
          const bill = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.bills")
              .selectAll()
              .where("id", "=", billId)
              .pipe(Effect.head, Effect.option),
          );
          if (Option.isNone(bill)) {
            return yield* new HttpError(404, "Bill not found");
          }

          const familyId = yield* getFamilyId(sessionId, userId);
          if (bill.value.family_id !== familyId) {
            return yield* new HttpError(403, "Forbidden");
          }

          const family = yield* getFamily(sessionId, familyId);

          const lineItems = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.bill_line_items")
              .selectAll()
              .where("bill_id", "=", billId)
              .orderBy("created_at"),
          );

          const buffer = yield* pdf.generateBillPdf({
            familyName: family.name,
            billNumber: bill.value.bill_number,
            status: bill.value.status,
            billingPeriodStart: String(bill.value.billing_period_start).slice(0, 10),
            billingPeriodEnd: String(bill.value.billing_period_end).slice(0, 10),
            dueDate: bill.value.due_date ? String(bill.value.due_date).slice(0, 10) : null,
            issuedAt: bill.value.issued_at
              ? new Date(bill.value.issued_at).toISOString().slice(0, 10)
              : null,
            paidAt: bill.value.paid_at
              ? new Date(bill.value.paid_at).toISOString().slice(0, 10)
              : null,
            createdAt: new Date(bill.value.created_at).toISOString().slice(0, 10),
            lineItems: lineItems.map((li) => ({
              description: li.description,
              lineType: li.line_type,
              quantity: li.quantity,
              unitPriceCents: li.unit_price_cents,
              amountCents: li.amount_cents,
            })),
            subtotalCents: bill.value.subtotal_cents,
            discountCents: bill.value.discount_cents,
            taxCents: bill.value.tax_cents,
            totalCents: bill.value.total_cents,
          });

          return buffer;
        }),

        paymentReceipt: Effect.fn("paymentReceipt")(function* (
          sessionId: string,
          userId: string,
          paymentId: string,
        ) {
          const payment = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.payments")
              .selectAll()
              .where("id", "=", paymentId)
              .pipe(Effect.head, Effect.option),
          );
          if (Option.isNone(payment)) {
            return yield* new HttpError(404, "Payment not found");
          }

          const familyId = yield* getFamilyId(sessionId, userId);
          if (payment.value.family_id !== familyId) {
            return yield* new HttpError(403, "Forbidden");
          }

          const family = yield* getFamily(sessionId, familyId);

          const allocations = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.payment_allocations as pa")
              .innerJoin("app_public.bills as b", "b.id", "pa.bill_id")
              .select([
                "b.bill_number",
                "pa.amount_cents",
              ])
              .where("pa.payment_id", "=", paymentId),
          );

          const buffer = yield* pdf.generateReceiptPdf({
            familyName: family.name,
            paymentNumber: payment.value.payment_number,
            amountCents: payment.value.amount_cents,
            method: payment.value.method,
            reference: payment.value.reference ?? null,
            receivedAt: new Date(payment.value.received_at).toISOString().slice(0, 10),
            allocations: allocations.map((a) => ({
              billNumber: a.bill_number,
              amountCents: a.amount_cents,
            })),
          });

          return buffer;
        }),

        // Admin: get any family's bill PDF
        adminBillPdf: Effect.fn("adminBillPdf")(function* (
          sessionId: string,
          billId: string,
        ) {
          const bill = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.bills")
              .selectAll()
              .where("id", "=", billId)
              .pipe(Effect.head, Effect.option),
          );
          if (Option.isNone(bill)) {
            return yield* new HttpError(404, "Bill not found");
          }

          const family = yield* getFamily(sessionId, bill.value.family_id);

          const lineItems = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.bill_line_items")
              .selectAll()
              .where("bill_id", "=", billId)
              .orderBy("created_at"),
          );

          const buffer = yield* pdf.generateBillPdf({
            familyName: family.name,
            billNumber: bill.value.bill_number,
            status: bill.value.status,
            billingPeriodStart: String(bill.value.billing_period_start).slice(0, 10),
            billingPeriodEnd: String(bill.value.billing_period_end).slice(0, 10),
            dueDate: bill.value.due_date ? String(bill.value.due_date).slice(0, 10) : null,
            issuedAt: bill.value.issued_at
              ? new Date(bill.value.issued_at).toISOString().slice(0, 10)
              : null,
            paidAt: bill.value.paid_at
              ? new Date(bill.value.paid_at).toISOString().slice(0, 10)
              : null,
            createdAt: new Date(bill.value.created_at).toISOString().slice(0, 10),
            lineItems: lineItems.map((li) => ({
              description: li.description,
              lineType: li.line_type,
              quantity: li.quantity,
              unitPriceCents: li.unit_price_cents,
              amountCents: li.amount_cents,
            })),
            subtotalCents: bill.value.subtotal_cents,
            discountCents: bill.value.discount_cents,
            taxCents: bill.value.tax_cents,
            totalCents: bill.value.total_cents,
          });

          return buffer;
        }),

        // Admin: get any family's payment receipt PDF
        adminPaymentReceipt: Effect.fn("adminPaymentReceipt")(function* (
          sessionId: string,
          paymentId: string,
        ) {
          const payment = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.payments")
              .selectAll()
              .where("id", "=", paymentId)
              .pipe(Effect.head, Effect.option),
          );
          if (Option.isNone(payment)) {
            return yield* new HttpError(404, "Payment not found");
          }

          const family = yield* getFamily(sessionId, payment.value.family_id);

          const allocations = yield* withAuthContext(sessionId, (db: AuthDB) =>
            db
              .selectFrom("app_public.payment_allocations as pa")
              .innerJoin("app_public.bills as b", "b.id", "pa.bill_id")
              .select([
                "b.bill_number",
                "pa.amount_cents",
              ])
              .where("pa.payment_id", "=", paymentId),
          );

          const buffer = yield* pdf.generateReceiptPdf({
            familyName: family.name,
            paymentNumber: payment.value.payment_number,
            amountCents: payment.value.amount_cents,
            method: payment.value.method,
            reference: payment.value.reference ?? null,
            receivedAt: new Date(payment.value.received_at).toISOString().slice(0, 10),
            allocations: allocations.map((a) => ({
              billNumber: a.bill_number,
              amountCents: a.amount_cents,
            })),
          });

          return buffer;
        }),
      };
    }),
  },
) {}
