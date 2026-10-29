import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect } from "effect";
import { familyBillingGroup } from "../../shared/httpApi.js";
import {
  FamilyBill,
  FamilyPayment,
  type Bill,
  type Payment,
  type FamilyCredit,
} from "../../shared/schemas.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { HttpError } from "../pgErrors.js";
import { FamilyBillingService } from "../services/familyBillingService.js";
import { SessionService, type SessionResult } from "../services/sessionService.js";
import type { Selectable } from "kysely";
import type {
  AppPublicBills,
  AppPublicPayments,
  AppPublicFamilyCredits,
  AppPublicBillLineItems,
  AppPublicBillAdjustments,
  AppPublicFamilyCreditApplications,
  AppPublicPaymentAllocations,
} from "../../generated/db.js";

type Auth = NonNullable<SessionResult>;

const familyBillingErrorStatuses = [400, 401, 403, 404, 500] as const;
const pdfErrorStatuses = [401, 403, 404, 500] as const;

const adaptFamilyBillingErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, familyBillingErrorStatuses);

const adaptPdfErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, pdfErrorStatuses);

function requireAuth(request: { cookies: Record<string, string | undefined> }) {
  return Effect.flatMap(
    SessionService.use((sessionService) =>
      sessionService.validateSessionToken(request.cookies.session),
    ),
    (auth) => (auth ? Effect.succeed(auth) : new HttpError(401, "Unauthorized")),
  );
}

// Serialize helpers
function isDateLike(value: unknown): value is { toISOString(): string } {
  return typeof value === "object" && value !== null && "toISOString" in value;
}

function serializeDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (isDateLike(value)) return value.toISOString();
  return String(value);
}

function serializeDateShort(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isDateLike(value)) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function serializeBill(bill: Selectable<AppPublicBills>): Bill {
  return {
    id: bill.id,
    family_id: bill.family_id,
    bill_number: bill.bill_number,
    status: bill.status,
    billing_period_start: serializeDateShort(bill.billing_period_start),
    billing_period_end: serializeDateShort(bill.billing_period_end),
    due_date: bill.due_date ? serializeDateShort(bill.due_date) : null,
    subtotal_cents: bill.subtotal_cents,
    discount_cents: bill.discount_cents,
    tax_cents: bill.tax_cents,
    total_cents: bill.total_cents,
    notes: bill.notes,
    created_at: serializeDate(bill.created_at)!,
    updated_at: serializeDate(bill.updated_at)!,
    issued_at: bill.issued_at ? serializeDate(bill.issued_at) : null,
    paid_at: bill.paid_at ? serializeDate(bill.paid_at) : null,
    cancelled_at: bill.cancelled_at ? serializeDate(bill.cancelled_at) : null,
    voided_at: bill.voided_at ? serializeDate(bill.voided_at) : null,
  };
}

function serializeFamilyBill(bill: Selectable<AppPublicBills>): FamilyBill {
  const { notes: _notes, ...publicBill } = serializeBill(bill);
  return publicBill;
}

function serializePayment(p: Selectable<AppPublicPayments>): Payment {
  return {
    id: p.id,
    family_id: p.family_id,
    payment_number: p.payment_number,
    amount_cents: p.amount_cents,
    method: p.method,
    reference: p.reference,
    received_at: serializeDate(p.received_at)!,
    notes: p.notes,
    created_at: serializeDate(p.created_at)!,
    updated_at: serializeDate(p.updated_at)!,
  };
}

function serializeFamilyPayment(p: Selectable<AppPublicPayments>): FamilyPayment {
  const { notes: _notes, ...publicPayment } = serializePayment(p);
  return publicPayment;
}

function serializeCredit(c: Selectable<AppPublicFamilyCredits>): FamilyCredit {
  return {
    id: c.id,
    family_id: c.family_id,
    student_id: c.student_id,
    amount_cents: c.amount_cents,
    reason: c.reason,
    expires_at: c.expires_at ? serializeDate(c.expires_at) : null,
    consumed_at: c.consumed_at ? serializeDate(c.consumed_at) : null,
    created_at: serializeDate(c.created_at)!,
  };
}

const familyBillingApi = HttpApi.make("dfg").add(familyBillingGroup);

export function makeFamilyBillingLayer() {
  return HttpApiBuilder.group(familyBillingApi, "familyBilling", (handlers) =>
    handlers
      .handle(
        "overview",
        Effect.fnUntraced(function* ({ request }) {
          const auth: Auth = yield* requireAuth(request);
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const raw = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.overview(auth.session.id, auth.user.id),
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
        Effect.fnUntraced(function* ({ request }) {
          const auth: Auth = yield* requireAuth(request);
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const bills = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.bills(auth.session.id, auth.user.id),
          );
          return bills.map(serializeFamilyBill);
        }, adaptFamilyBillingErrors),
      )
      .handle(
        "billDetail",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth: Auth = yield* requireAuth(request);
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const result = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.billDetail(auth.session.id, auth.user.id, params.id),
          );
          result.lineItems = result.lineItems ?? [];
          result.adjustments = result.adjustments ?? [];
          result.creditApplications = result.creditApplications ?? [];
          return {
            ...serializeFamilyBill(result),
            line_items: result.lineItems.map((li: Selectable<AppPublicBillLineItems>) => ({
              ...li,
              created_at: serializeDate(li.created_at)!,
            })),
            adjustments: result.adjustments.map((adj: Selectable<AppPublicBillAdjustments>) => ({
              id: adj.id,
              bill_id: adj.bill_id,
              amount_cents: adj.amount_cents,
              created_at: serializeDate(adj.created_at)!,
            })),
            credit_applications: result.creditApplications.map(
              (ca: Selectable<AppPublicFamilyCreditApplications>) => ({
                ...ca,
                created_at: serializeDate(ca.created_at)!,
              }),
            ),
          };
        }, adaptFamilyBillingErrors),
      )
      .handle(
        "payments",
        Effect.fnUntraced(function* ({ request }) {
          const auth: Auth = yield* requireAuth(request);
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const payments = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.payments(auth.session.id, auth.user.id),
          );
          return payments.map(serializeFamilyPayment);
        }, adaptFamilyBillingErrors),
      )
      .handle(
        "paymentDetail",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth: Auth = yield* requireAuth(request);
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const result = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.paymentDetail(auth.session.id, auth.user.id, params.id),
          );
          return {
            ...serializeFamilyPayment(result),
            allocations: (result.allocations ?? []).map(
              (a: Selectable<AppPublicPaymentAllocations>) => ({
                ...a,
                created_at: serializeDate(a.created_at)!,
              }),
            ),
          };
        }, adaptFamilyBillingErrors),
      )
      .handle(
        "credits",
        Effect.fnUntraced(function* ({ request }) {
          const auth: Auth = yield* requireAuth(request);
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const credits = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.credits(auth.session.id, auth.user.id),
          );
          return credits.map(serializeCredit);
        }, adaptFamilyBillingErrors),
      )
      .handle(
        "billPdf",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth: Auth = yield* requireAuth(request);
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const buffer = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.billPdf(auth.session.id, auth.user.id, params.id),
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
        Effect.fnUntraced(function* ({ request, params }) {
          const auth: Auth = yield* requireAuth(request);
          if (auth.user.role === "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const buffer = yield* FamilyBillingService.use((familyBillingService) =>
            familyBillingService.paymentReceipt(auth.session.id, auth.user.id, params.id),
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
