import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Admin, Csrf, Session } from "./guards.js";
import { Schema as S } from "effect";
import {
  Bill,
  PayerBillingDetail,
  PayerBillingSummary,
  AdminCredit,
  Discount,
  TaxExemption,
  Payment,
} from "../schemas.js";
import { params } from "./fields.js";
import { adminErrors } from "../httpApiErrors.js";

export const payersAdminGroup = HttpApiGroup.make("payersAdmin")
  // Billing endpoints
  .add(
    HttpApiEndpoint.get("billingPayers", "/billing/payers", {
      error: adminErrors,
      success: S.Array(PayerBillingSummary),
    }),
  )
  .add(
    HttpApiEndpoint.get("billingPayer", "/billing/payers/:payerId", {
      error: adminErrors,
      params: params("payerId"),
      success: PayerBillingDetail,
    }),
  )
  .add(
    HttpApiEndpoint.get("billingPayerBills", "/billing/payers/:payerId/bills", {
      error: adminErrors,
      params: params("payerId"),
      success: S.Array(Bill),
    }),
  )
  .add(
    HttpApiEndpoint.get("billingPayerPayments", "/billing/payers/:payerId/payments", {
      error: adminErrors,
      params: params("payerId"),
      success: S.Array(Payment),
    }),
  )
  .add(
    HttpApiEndpoint.get("billingPayerCredits", "/billing/payers/:payerId/credits", {
      error: adminErrors,
      params: params("payerId"),
      success: S.Array(AdminCredit),
    }),
  )
  .add(
    HttpApiEndpoint.get("payerDiscounts", "/billing/payers/:payerId/discounts", {
      error: adminErrors,
      params: params("payerId"),
      success: S.Array(Discount),
    }),
  )
  .add(
    HttpApiEndpoint.get("payerTaxExemptions", "/billing/payers/:payerId/tax-exemptions", {
      error: adminErrors,
      params: params("payerId"),
      success: S.Array(TaxExemption),
    }),
  )
  .middleware(Csrf)
  .middleware(Admin)
  .middleware(Session)
  .prefix("/api/admin");
