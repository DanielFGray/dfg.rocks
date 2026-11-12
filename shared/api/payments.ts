import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Admin, Csrf, Session } from "./guards.js";
import { Schema as S } from "effect";
import { Payment, PaymentMethod, Refund } from "../schemas.js";
import { params } from "./fields.js";
import { adminErrors } from "../httpApiErrors.js";

const PaymentAllocationPayload = S.Struct({
  bill_id: S.String,
  amount_cents: S.Finite,
});

const RecordPaymentPayload = S.Struct({
  payer_id: S.String,
  amount_cents: S.Finite,
  method: PaymentMethod,
  reference: S.optional(S.String),
  received_at: S.optional(S.DateFromString),
  notes: S.optional(S.String),
  allocations: S.Array(PaymentAllocationPayload),
});

const RefundPaymentPayload = S.Struct({
  amount_cents: S.Finite,
  reason: S.String.pipe(S.check(S.isMinLength(1))),
});

export const paymentsAdminGroup = HttpApiGroup.make("paymentsAdmin")
  .add(
    HttpApiEndpoint.post("recordPayment", "/billing/payments", {
      error: adminErrors,
      payload: RecordPaymentPayload,
      success: Payment,
    }),
  )
  .add(
    HttpApiEndpoint.post("refundPayment", "/billing/payments/:id/refund", {
      error: adminErrors,
      params: params("id"),
      payload: RefundPaymentPayload,
      success: Refund,
    }),
  )
  .middleware(Csrf)
  .middleware(Admin)
  .middleware(Session)
  .prefix("/api/admin");
