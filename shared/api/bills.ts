import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Schema as S } from "effect";
import { Adjustment, LessonBill, BillDetailResponse } from "../schemas.js";
import { params, BillingMonthQuery } from "./fields.js";
import { adminErrors } from "../httpApiErrors.js";

const CreateBillLineItemPayload = S.Struct({
  student_id: S.String,
  line_type: S.Union([
    S.Literal("lesson"),
    S.Literal("single_booking"),
    S.Literal("fee"),
    S.Literal("adjustment"),
    S.Literal("credit"),
  ]),
  description: S.String,
  quantity: S.Number,
  unit_price_cents: S.Number,
  amount_cents: S.Number,
});

const CreateBillPayload = S.Struct({
  payer_id: S.String,
  billing_period_start: S.String,
  billing_period_end: S.String,
  due_date: S.optional(S.String),
  line_items: S.Array(CreateBillLineItemPayload),
  notes: S.optional(S.String),
});

const VoidBillPayload = S.Struct({
  reason: S.String.pipe(S.check(S.isMinLength(1))),
});

const AdjustBillPayload = S.Struct({
  amount_cents: S.Number,
  reason: S.String.pipe(S.check(S.isMinLength(1))),
});

export const billsAdminGroup = HttpApiGroup.make("billsAdmin")
  .add(
    HttpApiEndpoint.get("lessonBills", "/billing/lesson-bills", {
      error: adminErrors,
      query: BillingMonthQuery,
      success: S.Array(LessonBill),
    }),
  )
  .add(
    HttpApiEndpoint.post("createBill", "/billing/bills", {
      error: adminErrors,
      payload: CreateBillPayload,
      success: BillDetailResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getBill", "/billing/bills/:id", {
      error: adminErrors,
      params: params("id"),
      success: BillDetailResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("issueBill", "/billing/bills/:id/issue", {
      error: adminErrors,
      params: params("id"),
      success: BillDetailResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("cancelBill", "/billing/bills/:id/cancel", {
      error: adminErrors,
      params: params("id"),
      success: BillDetailResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("voidBill", "/billing/bills/:id/void", {
      error: adminErrors,
      params: params("id"),
      payload: VoidBillPayload,
      success: BillDetailResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("adjustBill", "/billing/bills/:id/adjust", {
      error: adminErrors,
      params: params("id"),
      payload: AdjustBillPayload,
      success: Adjustment,
    }),
  )
  .prefix("/api/admin");
