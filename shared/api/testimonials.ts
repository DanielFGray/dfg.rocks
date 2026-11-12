import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Admin, Csrf, Session } from "./guards.js";
import { Schema as S } from "effect";
import { Testimonial, SuccessResponse } from "../schemas.js";
import { params } from "./fields.js";
import { signedInErrors, adminErrors } from "../httpApiErrors.js";

export const ReminderIntervalResponse = S.Struct({
  success: S.Literal(true),
  interval_days: S.Finite,
});

export const TestimonialReminderIntervalResponse = S.Struct({
  interval_days: S.Finite,
});

const TestimonialPayload = S.Struct({
  body: S.String.pipe(S.check(S.isMinLength(20)), S.check(S.isMaxLength(2000))),
});

const SaveReminderIntervalPayload = S.Struct({
  interval_days: S.Finite.pipe(S.check(S.isBetween({ minimum: 1, maximum: 365 }))),
});

const UpdateTestimonialApprovalPayload = S.Struct({
  is_approved: S.Boolean,
});

export const testimonialsGroup = HttpApiGroup.make("testimonials")
  .add(
    HttpApiEndpoint.put("upsertTestimonial", "/testimonials", {
      error: signedInErrors,
      payload: TestimonialPayload,
      success: Testimonial,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteTestimonial", "/testimonials", {
      error: signedInErrors,
      success: SuccessResponse,
    }),
  )
  .middleware(Session)
  .prefix("/api");

export const testimonialsAdminGroup = HttpApiGroup.make("testimonialsAdmin")
  .add(
    HttpApiEndpoint.get("testimonialReminderInterval", "/testimonial-reminder-interval", {
      error: adminErrors,
      success: TestimonialReminderIntervalResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveTestimonialReminderInterval", "/testimonial-reminder-interval", {
      error: adminErrors,
      payload: SaveReminderIntervalPayload,
      success: ReminderIntervalResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateTestimonialApproval", "/testimonials/:id", {
      error: adminErrors,
      params: params("id"),
      payload: UpdateTestimonialApprovalPayload,
      success: SuccessResponse,
    }),
  )
  .middleware(Csrf)
  .middleware(Admin)
  .middleware(Session)
  .prefix("/api/admin");
