import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession, type SignedIn } from "../../shared/api/guards.js";
import { serializeTestimonial } from "../../shared/responseMappers.js";
import { HttpError } from "../pgErrors.js";
import { Testimonials } from "../services/testimonials.js";
import { TestimonialReminder } from "../services/testimonialReminder.js";
import { adaptSignedInErrors, adaptAdminErrors } from "../httpApiErrors.js";

const assertCanManageTestimonial = Effect.fnUntraced(function* (auth: SignedIn) {
  if (auth.user.role === "admin") {
    return yield* new HttpError({ status: 403, message: "Admins cannot manage testimonials" });
  }
});

export const TestimonialsApiGroupLive = HttpApiBuilder.group(Contract, "testimonials", (handlers) =>
  handlers
    .handle(
      "upsertTestimonial",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        yield* assertCanManageTestimonial(auth);
        const testimonial = yield* Testimonials.use((testimonialService) =>
          testimonialService
            .upsertTestimonial(auth.user.id, payload.body)
            .pipe(withAuthContext(auth.session.id)),
        );
        return serializeTestimonial(testimonial);
      }, adaptSignedInErrors),
    )
    .handle(
      "deleteTestimonial",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        yield* assertCanManageTestimonial(auth);
        yield* Testimonials.use((testimonialService) =>
          testimonialService.deleteTestimonial(auth.user.id).pipe(withAuthContext(auth.session.id)),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    ),
);

export const TestimonialsAdminApiGroupLive = HttpApiBuilder.group(
  Contract,
  "testimonialsAdmin",
  (handlers) =>
    handlers
      .handle(
        "testimonialReminderInterval",
        Effect.fnUntraced(function* () {
          return {
            interval_days: yield* TestimonialReminder.use((testimonialReminderService) =>
              testimonialReminderService.getIntervalDays(),
            ),
          };
        }, adaptAdminErrors),
      )
      .handle(
        "saveTestimonialReminderInterval",
        Effect.fnUntraced(function* ({ payload }) {
          yield* TestimonialReminder.use((testimonialReminderService) =>
            testimonialReminderService.setIntervalDays(payload.interval_days),
          );
          yield* TestimonialReminder.use((testimonialReminderService) =>
            testimonialReminderService.rescheduleAll(payload.interval_days),
          );
          return {
            success: true as const,
            interval_days: payload.interval_days,
          };
        }, adaptAdminErrors),
      )
      .handle(
        "updateTestimonialApproval",
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          const testimonial = yield* Testimonials.use((testimonialService) =>
            testimonialService
              .updateTestimonialApproval(params.id, payload.is_approved)
              .pipe(withAuthContext(auth.session.id)),
          );
          if (testimonial.is_approved) {
            yield* TestimonialReminder.use((testimonialReminderService) =>
              testimonialReminderService.clearReminderState(testimonial.user_id),
            );
          } else if (testimonial.role === "student" || testimonial.role === "parent") {
            yield* TestimonialReminder.use((testimonialReminderService) =>
              testimonialReminderService.scheduleNextReminder(testimonial.user_id),
            );
          }
          return { success: true as const };
        }, adaptAdminErrors),
      ),
);
