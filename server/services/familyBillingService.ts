import { Effect, Option, Context, Layer } from "effect";
import { RequestDatabase } from "../requestDatabase.js";
import { HttpError } from "../pgErrors.js";
import { PdfService } from "./pdfService.js";
import { BillingLedgerService, getPayer } from "./billingLedgerService.js";

/**
 * The member-facing billing views. Every query runs under the caller's RLS,
 * which shows the ledgers of the caller and of each family billing contact the
 * caller shares a family with; a row RLS hides is a 404.
 */
export class FamilyBillingService extends Context.Service<FamilyBillingService>()(
  "FamilyBillingService",
  {
    make: Effect.gen(function* () {
      const pdf = yield* PdfService;
      const ledger = yield* BillingLedgerService;

      return {
        overview: Effect.fn("overview")(function* () {
          const bills = yield* RequestDatabase.use((db) =>
            db.execute(db.selectFrom("app_public.bills").selectAll().orderBy("created_at", "desc")),
          );

          const payments = yield* RequestDatabase.use((db) =>
            db.execute(
              db.selectFrom("app_public.payments").selectAll().orderBy("received_at", "desc"),
            ),
          );

          const credits = yield* RequestDatabase.use((db) =>
            db.execute(
              db.selectFrom("app_public.credits").selectAll().orderBy("created_at", "desc"),
            ),
          );

          // Balances add up across payers, so the overview sums each visible ledger.
          const payerIds = new Set([...bills, ...payments, ...credits].map((row) => row.payer_id));
          const ledgerBalance = (yield* Effect.forEach(payerIds, (payerId) =>
            ledger.getPayerBalance(payerId),
          )).reduce(
            (sum, balance) => ({
              outstandingCents: sum.outstandingCents + balance.outstandingCents,
              creditBalanceCents: sum.creditBalanceCents + balance.creditBalanceCents,
              overdueCents: sum.overdueCents + balance.overdueCents,
            }),
            { outstandingCents: 0, creditBalanceCents: 0, overdueCents: 0 },
          );
          const grossOutstandingCents = bills
            .filter((b) => b.status === "issued" || b.status === "paid")
            .reduce((sum, b) => sum + b.total_cents, 0);

          const now = new Date();
          const overdueBills = bills.filter(
            (b) => b.status === "issued" && b.due_date && new Date(b.due_date) < now,
          );
          const openBills = bills.filter((b) => b.status === "issued" || b.status === "draft");
          const recentPayments = payments.slice(0, 10);

          return {
            balance: {
              outstanding_cents: ledgerBalance.outstandingCents,
              credit_balance_cents: ledgerBalance.creditBalanceCents,
              available_credit_cents: ledgerBalance.creditBalanceCents,
              overdue_cents: ledgerBalance.overdueCents,
              gross_outstanding_cents: grossOutstandingCents,
              net_due_cents: Math.max(
                0,
                ledgerBalance.outstandingCents - ledgerBalance.creditBalanceCents,
              ),
            },
            open_bills: openBills,
            overdue_bills: overdueBills,
            recent_payments: recentPayments,
            credits: credits,
          };
        }),

        bills: Effect.fn("bills")(function* () {
          return yield* RequestDatabase.use((db) =>
            db.execute(db.selectFrom("app_public.bills").selectAll().orderBy("created_at", "desc")),
          );
        }),

        billDetail: Effect.fn("billDetail")(function* (billId: string) {
          const bill = yield* RequestDatabase.use((db) =>
            db
              .execute(db.selectFrom("app_public.bills").selectAll().where("id", "=", billId))
              .pipe(Effect.head, Effect.option),
          );
          if (Option.isNone(bill)) {
            return yield* new HttpError(404, "Bill not found");
          }

          const lineItems = yield* RequestDatabase.use((db) =>
            db.execute(
              db
                .selectFrom("app_public.bill_line_items")
                .selectAll()
                .where("bill_id", "=", billId)
                .orderBy("created_at"),
            ),
          );

          const adjustments = yield* RequestDatabase.use((db) =>
            db.execute(
              db
                .selectFrom("app_public.bill_adjustments")
                .selectAll()
                .where("bill_id", "=", billId)
                .orderBy("created_at"),
            ),
          );

          const creditApplications = yield* RequestDatabase.use((db) =>
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

        payments: Effect.fn("payments")(function* () {
          return yield* RequestDatabase.use((db) =>
            db.execute(
              db.selectFrom("app_public.payments").selectAll().orderBy("received_at", "desc"),
            ),
          );
        }),

        paymentDetail: Effect.fn("paymentDetail")(function* (paymentId: string) {
          const payment = yield* RequestDatabase.use((db) =>
            db
              .execute(db.selectFrom("app_public.payments").selectAll().where("id", "=", paymentId))
              .pipe(Effect.head, Effect.option),
          );
          if (Option.isNone(payment)) {
            return yield* new HttpError(404, "Payment not found");
          }
          const allocations = yield* RequestDatabase.use((db) =>
            db.execute(
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
            ),
          );

          return {
            ...payment.value,
            allocations,
          };
        }),

        credits: Effect.fn("credits")(function* () {
          return yield* RequestDatabase.use((db) =>
            db.execute(
              db.selectFrom("app_public.credits").selectAll().orderBy("created_at", "desc"),
            ),
          );
        }),

        billPdf: Effect.fn("billPdf")(function* (billId: string) {
          const bill = yield* RequestDatabase.use((db) =>
            db
              .execute(db.selectFrom("app_public.bills").selectAll().where("id", "=", billId))
              .pipe(Effect.head, Effect.option),
          );
          if (Option.isNone(bill)) {
            return yield* new HttpError(404, "Bill not found");
          }
          const payer = yield* RequestDatabase.use((db) => getPayer(db, bill.value.payer_id));

          const lineItems = yield* RequestDatabase.use((db) =>
            db.execute(
              db
                .selectFrom("app_public.bill_line_items")
                .selectAll()
                .where("bill_id", "=", billId)
                .orderBy("created_at"),
            ),
          );

          const buffer = yield* pdf.generateBillPdf({
            payerName: payer.name,
            billNumber: bill.value.bill_number,
            status: bill.value.status,
            billingPeriodStart: bill.value.billing_period_start,
            billingPeriodEnd: bill.value.billing_period_end,
            dueDate: bill.value.due_date,
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

        paymentReceipt: Effect.fn("paymentReceipt")(function* (paymentId: string) {
          const payment = yield* RequestDatabase.use((db) =>
            db
              .execute(db.selectFrom("app_public.payments").selectAll().where("id", "=", paymentId))
              .pipe(Effect.head, Effect.option),
          );
          if (Option.isNone(payment)) {
            return yield* new HttpError(404, "Payment not found");
          }
          const payer = yield* RequestDatabase.use((db) => getPayer(db, payment.value.payer_id));

          const allocations = yield* RequestDatabase.use((db) =>
            db.execute(
              db
                .selectFrom("app_public.payment_allocations as pa")
                .innerJoin("app_public.bills as b", "b.id", "pa.bill_id")
                .select(["b.bill_number", "pa.amount_cents"])
                .where("pa.payment_id", "=", paymentId),
            ),
          );

          const buffer = yield* pdf.generateReceiptPdf({
            payerName: payer.name,
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
) {
  static readonly layer = Layer.effect(this, this.make);
}
