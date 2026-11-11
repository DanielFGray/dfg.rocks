import {
  type Adjustment as AdjustmentResponse,
  type Bill as BillResponse,
  type BillDetailResponse as BillDetailResponseType,
  type CreditApplication as CreditApplicationResponse,
  type AdminCredit as CreditResponse,
  type Discount as DiscountResponse,
  type TaxExemption as TaxExemptionResponse,
  type Payment as PaymentResponse,
  type Refund as RefundResponse,
  type TaxRate as TaxRateResponse,
} from "../../shared/schemas.js";
import { type Selectable } from "kysely";
import {
  type AppPublicBills,
  type AppPublicPayments,
  type AppPublicCredits,
  type AppPublicBillLineItems,
  type AppPublicBillAdjustments,
  type AppPublicCreditApplications,
  type AppPublicDiscounts,
  type AppPublicTaxRates,
  type AppPublicTaxExemptions,
  type AppPublicRefunds,
} from "../../generated/db.js";

// Wire forms of billing rows for the admin billing endpoints. Dates leave as ISO strings, and
// period and due dates as YYYY-MM-DD.
function isDateLike(value: unknown): value is { toISOString(): string } {
  return typeof value === "object" && value !== null && "toISOString" in value;
}

export function serializeBillingDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (isDateLike(value)) return value.toISOString();
  return String(value);
}

export function serializeBillingDateShort(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isDateLike(value)) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function serializeBillResponse(bill: Selectable<AppPublicBills>): BillResponse {
  return {
    ...bill,
    billing_period_start: serializeBillingDateShort(bill.billing_period_start),
    billing_period_end: serializeBillingDateShort(bill.billing_period_end),
    due_date: bill.due_date ? serializeBillingDateShort(bill.due_date) : null,
    created_at: serializeBillingDate(bill.created_at)!,
    updated_at: serializeBillingDate(bill.updated_at)!,
    issued_at: bill.issued_at ? serializeBillingDate(bill.issued_at) : null,
    paid_at: bill.paid_at ? serializeBillingDate(bill.paid_at) : null,
    cancelled_at: bill.cancelled_at ? serializeBillingDate(bill.cancelled_at) : null,
    voided_at: bill.voided_at ? serializeBillingDate(bill.voided_at) : null,
  };
}

export function serializePaymentResponse(p: Selectable<AppPublicPayments>): PaymentResponse {
  return {
    ...p,
    received_at: serializeBillingDate(p.received_at)!,
    created_at: serializeBillingDate(p.created_at)!,
    updated_at: serializeBillingDate(p.updated_at)!,
  };
}

export function serializeCreditResponse(c: Selectable<AppPublicCredits>): CreditResponse {
  return {
    ...c,
    expires_at: c.expires_at ? serializeBillingDate(c.expires_at) : null,
    consumed_at: c.consumed_at ? serializeBillingDate(c.consumed_at) : null,
    created_at: serializeBillingDate(c.created_at)!,
  };
}

export function serializeAdjustment(a: Selectable<AppPublicBillAdjustments>): AdjustmentResponse {
  return {
    id: a.id,
    bill_id: a.bill_id,
    amount_cents: a.amount_cents,
    reason: a.reason,
    created_at: serializeBillingDate(a.created_at)!,
  };
}

export function serializeRefund(r: Selectable<AppPublicRefunds>): RefundResponse {
  return {
    id: r.id,
    payment_id: r.payment_id,
    amount_cents: r.amount_cents,
    reason: r.reason,
    created_by: r.created_by,
    refunded_at: serializeBillingDate(r.refunded_at)!,
    notes: r.notes,
    created_at: serializeBillingDate(r.created_at)!,
  };
}

export function serializeCreditApplication(
  ca: Selectable<AppPublicCreditApplications>,
): CreditApplicationResponse {
  return {
    id: ca.id,
    credit_id: ca.credit_id,
    bill_id: ca.bill_id,
    amount_cents: ca.amount_cents,
    created_at: serializeBillingDate(ca.created_at)!,
  };
}

export function serializeDiscount(d: Selectable<AppPublicDiscounts>): DiscountResponse {
  return {
    ...d,
    discount_type: d.discount_type as DiscountResponse["discount_type"],
    applies_to: d.applies_to as DiscountResponse["applies_to"],
    effective_from: serializeBillingDateShort(d.effective_from),
    effective_until: d.effective_until ? serializeBillingDateShort(d.effective_until) : null,
    created_at: serializeBillingDate(d.created_at)!,
    updated_at: serializeBillingDate(d.updated_at)!,
  };
}

export function serializeTaxRate(r: Selectable<AppPublicTaxRates>): TaxRateResponse {
  return {
    ...r,
    rate_percent: Number(r.rate_percent),
    applies_to: r.applies_to as TaxRateResponse["applies_to"],
    effective_from: serializeBillingDateShort(r.effective_from),
    effective_until: r.effective_until ? serializeBillingDateShort(r.effective_until) : null,
    created_at: serializeBillingDate(r.created_at)!,
    updated_at: serializeBillingDate(r.updated_at)!,
  };
}

export function serializeTaxExemption(e: Selectable<AppPublicTaxExemptions>): TaxExemptionResponse {
  return {
    ...e,
    effective_from: serializeBillingDateShort(e.effective_from),
    effective_until: e.effective_until ? serializeBillingDateShort(e.effective_until) : null,
    created_at: serializeBillingDate(e.created_at)!,
  };
}

export function mapBillDetail(
  detail: {
    lineItems: readonly Selectable<AppPublicBillLineItems>[];
    adjustments: readonly Selectable<AppPublicBillAdjustments>[];
    creditApplications: readonly Selectable<AppPublicCreditApplications>[];
  },
  bill: Selectable<AppPublicBills>,
): BillDetailResponseType {
  return {
    ...serializeBillResponse(bill),
    line_items: detail.lineItems.map((li: Selectable<AppPublicBillLineItems>) => ({
      ...li,
      created_at: serializeBillingDate(li.created_at)!,
    })),
    adjustments: detail.adjustments.map((adj: Selectable<AppPublicBillAdjustments>) => ({
      ...adj,
      created_at: serializeBillingDate(adj.created_at)!,
    })),
    credit_applications: detail.creditApplications.map(
      (ca: Selectable<AppPublicCreditApplications>) => ({
        ...ca,
        created_at: serializeBillingDate(ca.created_at)!,
      }),
    ),
  };
}
