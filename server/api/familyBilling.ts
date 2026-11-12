import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import {
  FamilyBill,
  FamilyPayment,
  type Bill,
  type Payment,
  type Credit,
} from "../../shared/schemas.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { HttpError } from "../pgErrors.js";
import { FamilyBillingService } from "../services/familyBillingService.js";
import type { Selectable } from "kysely";
import type {
  AppPublicBills,
  AppPublicPayments,
  AppPublicCredits,
  AppPublicBillAdjustments,
} from "../../generated/db.js";

const familyBillingErrorStatuses = [400, 401, 403, 404, 500] as const;
const pdfErrorStatuses = [401, 403, 404, 500] as const;

const adaptFamilyBillingErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, familyBillingErrorStatuses);

const adaptPdfErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, pdfErrorStatuses);

function serializeBill(bill: Selectable<AppPublicBills>): Bill {
  return {
    id: bill.id,
    payer_id: bill.payer_id,
    bill_number: bill.bill_number,
    status: bill.status,
    billing_period_start: bill.billing_period_start,
    billing_period_end: bill.billing_period_end,
    due_date: bill.due_date,
    subtotal_cents: bill.subtotal_cents,
    discount_cents: bill.discount_cents,
    tax_cents: bill.tax_cents,
    total_cents: bill.total_cents,
    notes: bill.notes,
    created_at: bill.created_at,
    updated_at: bill.updated_at,
    issued_at: bill.issued_at,
    paid_at: bill.paid_at,
    cancelled_at: bill.cancelled_at,
    voided_at: bill.voided_at,
  };
}

function serializeFamilyBill(bill: Selectable<AppPublicBills>): FamilyBill {
  const { notes: _notes, ...publicBill } = serializeBill(bill);
  return publicBill;
}

function serializePayment(p: Selectable<AppPublicPayments>): Payment {
  return {
    id: p.id,
    payer_id: p.payer_id,
    payment_number: p.payment_number,
    amount_cents: p.amount_cents,
    method: p.method,
    reference: p.reference,
    received_at: p.received_at,
    notes: p.notes,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

function serializeFamilyPayment(p: Selectable<AppPublicPayments>): FamilyPayment {
  const { notes: _notes, ...publicPayment } = serializePayment(p);
  return publicPayment;
}

function serializeCredit(c: Selectable<AppPublicCredits>): Credit {
  return {
    id: c.id,
    payer_id: c.payer_id,
    student_id: c.student_id,
    amount_cents: c.amount_cents,
    reason: c.reason,
    expires_at: c.expires_at,
    consumed_at: c.consumed_at,
    created_at: c.created_at,
  };
}

export function makeFamilyBillingLayer() {
  return HttpApiBuilder.group(Contract, "familyBilling", (handlers) =>
    handlers
      .handle(
        "overview",
        Effect.fnUntraced(function* () {
          const auth = yield* CurrentSession;
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const raw = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.overview().pipe(withAuthContext(auth.session.id)),
          );
          return {
            ...raw,
            open_bills: raw.open_bills.map(serializeFamilyBill),
            overdue_bills: raw.overdue_bills.map(serializeFamilyBill),
            recent_payments: raw.recent_payments.map(serializeFamilyPayment),
            credits: raw.credits.map(serializeCredit),
          };
        }, adaptFamilyBillingErrors),
      )
      .handle(
        "bills",
        Effect.fnUntraced(function* () {
          const auth = yield* CurrentSession;
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const bills = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.bills().pipe(withAuthContext(auth.session.id)),
          );
          return bills.map(serializeFamilyBill);
        }, adaptFamilyBillingErrors),
      )
      .handle(
        "billDetail",
        Effect.fnUntraced(function* ({ params }) {
          const auth = yield* CurrentSession;
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const result = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.billDetail(params.id).pipe(withAuthContext(auth.session.id)),
          );
          result.lineItems = result.lineItems ?? [];
          result.adjustments = result.adjustments ?? [];
          result.creditApplications = result.creditApplications ?? [];
          return {
            ...serializeFamilyBill(result),
            line_items: result.lineItems,
            adjustments: result.adjustments.map((adj: Selectable<AppPublicBillAdjustments>) => ({
              id: adj.id,
              bill_id: adj.bill_id,
              amount_cents: adj.amount_cents,
              created_at: adj.created_at,
            })),
            credit_applications: result.creditApplications,
          };
        }, adaptFamilyBillingErrors),
      )
      .handle(
        "payments",
        Effect.fnUntraced(function* () {
          const auth = yield* CurrentSession;
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const payments = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.payments().pipe(withAuthContext(auth.session.id)),
          );
          return payments.map(serializeFamilyPayment);
        }, adaptFamilyBillingErrors),
      )
      .handle(
        "paymentDetail",
        Effect.fnUntraced(function* ({ params }) {
          const auth = yield* CurrentSession;
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const result = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.paymentDetail(params.id).pipe(withAuthContext(auth.session.id)),
          );
          return {
            ...serializeFamilyPayment(result),
            allocations: result.allocations ?? [],
          };
        }, adaptFamilyBillingErrors),
      )
      .handle(
        "credits",
        Effect.fnUntraced(function* () {
          const auth = yield* CurrentSession;
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const credits = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.credits().pipe(withAuthContext(auth.session.id)),
          );
          return credits.map(serializeCredit);
        }, adaptFamilyBillingErrors),
      )
      .handle(
        "billPdf",
        Effect.fnUntraced(function* ({ params }) {
          const auth = yield* CurrentSession;
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const buffer = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.billPdf(params.id).pipe(withAuthContext(auth.session.id)),
          );
          return HttpServerResponse.fromWeb(
            new Response(new Uint8Array(buffer), {
              headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="bill-${params.id}.pdf"`,
              },
            }),
          );
        }, adaptPdfErrors),
      )
      .handle(
        "paymentReceipt",
        Effect.fnUntraced(function* ({ params }) {
          const auth = yield* CurrentSession;
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const buffer = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.paymentReceipt(params.id).pipe(withAuthContext(auth.session.id)),
          );
          return HttpServerResponse.fromWeb(
            new Response(new Uint8Array(buffer), {
              headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="receipt-${params.id}.pdf"`,
              },
            }),
          );
        }, adaptPdfErrors),
      ),
  );
}
