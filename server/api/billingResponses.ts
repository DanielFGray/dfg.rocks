import {
  type Adjustment as AdjustmentResponse,
  type BillDetailResponse as BillDetailResponseType,
  type CreditApplication as CreditApplicationResponse,
  type Discount as DiscountResponse,
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
  type AppPublicRefunds,
} from "../../generated/db.js";

// Wire forms of billing rows for the admin billing endpoints.
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
  };
}

export function serializeTaxRate(r: Selectable<AppPublicTaxRates>): TaxRateResponse {
  return {
    ...r,
    rate_percent: Number(r.rate_percent),
    applies_to: r.applies_to as TaxRateResponse["applies_to"],
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
    ...bill,
    line_items: detail.lineItems,
    adjustments: detail.adjustments,
    credit_applications: detail.creditApplications,
  };
}
