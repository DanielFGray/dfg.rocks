import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Session } from "./guards.js";
import { Schema as S } from "effect";
import {
  FamilyBill,
  FamilyBillDetailResponse,
  FamilyPayment,
  FamilyPaymentDetail,
  FamilyBillingOverview,
  Credit,
} from "../schemas.js";
import {
  BadRequestErrorSchema,
  ForbiddenErrorSchema,
  InternalServerErrorSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
} from "../httpApiErrors.js";
import { params } from "./fields.js";

const familyBillingErrors = [
  BadRequestErrorSchema,
  UnauthorizedErrorSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  InternalServerErrorSchema,
] as const;

export const familyBillingGroup = HttpApiGroup.make("familyBilling")
  .add(
    HttpApiEndpoint.get("overview", "/billing", {
      error: familyBillingErrors,
      success: FamilyBillingOverview,
    }),
  )
  .add(
    HttpApiEndpoint.get("bills", "/billing/bills", {
      error: familyBillingErrors,
      success: S.Array(FamilyBill),
    }),
  )
  .add(
    HttpApiEndpoint.get("billDetail", "/billing/bills/:id", {
      error: familyBillingErrors,
      params: params("id"),
      success: FamilyBillDetailResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("payments", "/billing/payments", {
      error: familyBillingErrors,
      success: S.Array(FamilyPayment),
    }),
  )
  .add(
    HttpApiEndpoint.get("paymentDetail", "/billing/payments/:id", {
      error: familyBillingErrors,
      params: params("id"),
      success: FamilyPaymentDetail,
    }),
  )
  .add(
    HttpApiEndpoint.get("credits", "/billing/credits", {
      error: familyBillingErrors,
      success: S.Array(Credit),
    }),
  )
  .add(
    HttpApiEndpoint.get("billPdf", "/billing/bills/:id/pdf", {
      error: familyBillingErrors,
      params: params("id"),
    }),
  )
  .add(
    HttpApiEndpoint.get("paymentReceipt", "/billing/payments/:id/receipt", {
      error: familyBillingErrors,
      params: params("id"),
    }),
  )
  .middleware(Session)
  .prefix("/api/family");
