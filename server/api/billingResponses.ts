import {
  type Adjustment as AdjustmentResponse,
  type Bill as BillResponse,
  type BillDetailResponse as BillDetailResponseType,
  type CreditApplication as CreditApplicationResponse,
  type Discount as DiscountResponse,
  type TaxExemption as TaxExemptionResponse,
  type Refund as RefundResponse,
  type TaxRate as TaxRateResponse,
} from "../../shared/schemas.js";
import { type Selectable } from "kysely";
import {
  type AppPublicBills,
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
  };
}

export function serializeAdjustment(a: Selectable<AppPublicBillAdjustments>): AdjustmentResponse {
  return {
    id: a.id,
    bill_id: a.bill_id,
    amount_cents: a.amount_cents,
    reason: a.reason,
    created_at: a.created_at,
  };
}

export function serializeRefund(r: Selectable<AppPublicRefunds>): RefundResponse {
  return {
    id: r.id,
    payment_id: r.payment_id,
    amount_cents: r.amount_cents,
    reason: r.reason,
    created_by: r.created_by,
    refunded_at: r.refunded_at,
    notes: r.notes,
    created_at: r.created_at,
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
    created_at: ca.created_at,
  };
}

export function serializeDiscount(d: Selectable<AppPublicDiscounts>): DiscountResponse {
  return {
    ...d,
    discount_type: d.discount_type as DiscountResponse["discount_type"],
    applies_to: d.applies_to as DiscountResponse["applies_to"],
    effective_from: serializeBillingDateShort(d.effective_from),
    effective_until: d.effective_until ? serializeBillingDateShort(d.effective_until) : null,
  };
}

export function serializeTaxRate(r: Selectable<AppPublicTaxRates>): TaxRateResponse {
  return {
    ...r,
    rate_percent: Number(r.rate_percent),
    applies_to: r.applies_to as TaxRateResponse["applies_to"],
    effective_from: serializeBillingDateShort(r.effective_from),
    effective_until: r.effective_until ? serializeBillingDateShort(r.effective_until) : null,
  };
}

export function serializeTaxExemption(e: Selectable<AppPublicTaxExemptions>): TaxExemptionResponse {
  return {
    ...e,
    effective_from: serializeBillingDateShort(e.effective_from),
    effective_until: e.effective_until ? serializeBillingDateShort(e.effective_until) : null,
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
    line_items: detail.lineItems,
    adjustments: detail.adjustments,
    credit_applications: detail.creditApplications,
  };
}
