import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Admin, Csrf, Session } from "./guards.js";
import { Schema as S } from "effect";
import { Discount, TaxExemption, TaxRate } from "../schemas.js";
import { params } from "./fields.js";
import { adminErrors } from "../httpApiErrors.js";

const CreateDiscountPayload = S.Struct({
  payer_id: S.String,
  label: S.String,
  discount_type: S.Literals(["percentage", "fixed"]),
  discount_value: S.Finite,
  applies_to: S.Union([S.Literal("all"), S.Literal("tuition"), S.Literal("fees")]),
  effective_from: S.String,
  effective_until: S.optional(S.String),
});

const UpdateDiscountPayload = S.Struct({
  label: S.optional(S.String),
  discount_type: S.optional(S.Literals(["percentage", "fixed"])),
  discount_value: S.optional(S.Finite),
  applies_to: S.optional(S.Union([S.Literal("all"), S.Literal("tuition"), S.Literal("fees")])),
  effective_from: S.optional(S.String),
  effective_until: S.optional(S.String),
  is_active: S.optional(S.Boolean),
});

const CreateTaxRatePayload = S.Struct({
  label: S.String,
  jurisdiction: S.String,
  rate_percent: S.Finite.pipe(S.check(S.isBetween({ minimum: 0, maximum: 30 }))),
  applies_to: S.Union([S.Literal("all"), S.Literal("tuition"), S.Literal("fees")]),
  effective_from: S.String,
  effective_until: S.optional(S.String),
});

const CreateTaxExemptionPayload = S.Struct({
  payer_id: S.String,
  tax_rate_id: S.String,
  exemption_reason: S.String,
  effective_from: S.String,
  effective_until: S.optional(S.String),
});

export const billingRatesAdminGroup = HttpApiGroup.make("billingRatesAdmin")
  .add(
    HttpApiEndpoint.post("createDiscount", "/billing/discounts", {
      error: adminErrors,
      payload: CreateDiscountPayload,
      success: Discount,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateDiscount", "/billing/discounts/:id", {
      error: adminErrors,
      params: params("id"),
      payload: UpdateDiscountPayload,
      success: Discount,
    }),
  )
  .add(
    HttpApiEndpoint.get("listTaxRates", "/billing/tax-rates", {
      error: adminErrors,
      success: S.Array(TaxRate),
    }),
  )
  .add(
    HttpApiEndpoint.post("createTaxRate", "/billing/tax-rates", {
      error: adminErrors,
      payload: CreateTaxRatePayload,
      success: TaxRate,
    }),
  )
  .add(
    HttpApiEndpoint.post("createTaxExemption", "/billing/tax-exemptions", {
      error: adminErrors,
      payload: CreateTaxExemptionPayload,
      success: TaxExemption,
    }),
  )
  .middleware(Csrf)
  .middleware(Admin)
  .middleware(Session)
  .prefix("/api/admin");
