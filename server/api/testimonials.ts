import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession, type SignedIn } from "../../shared/api/guards.js";
import { serializeTestimonial } from "../../shared/responseMappers.js";
import { HttpError } from "../pgErrors.js";
import { AuthenticatedRouteService } from "../services/authenticatedRouteService.js";
import { AdminRouteService } from "../services/adminRouteService.js";
import { TestimonialReminderService } from "../services/testimonialReminderService.js";
import { adaptSignedInErrors, adaptAdminErrors } from "../httpApiErrors.js";

const assertCanManageTestimonial = Effect.fnUntraced(function* (auth: SignedIn) {
  if (auth.user.role === "admin") {
    return yield* new HttpError(403, "Admins cannot manage testimonials");
  }
});

export const TestimonialsApiGroupLive = HttpApiBuilder.group(Contract, "testimonials", (handlers) =>
  handlers
    .handle(
      "upsertTestimonial",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        yield* assertCanManageTestimonial(auth);
        const testimonial = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.upsertTestimonial(auth.session.id, auth.user.id, payload.body),
        );
        return serializeTestimonial(testimonial);
      }, adaptSignedInErrors),
    )
    .handle(
      "deleteTestimonial",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        yield* assertCanManageTestimonial(auth);
        yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.deleteTestimonial(auth.session.id, auth.user.id),
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
            interval_days: yield* TestimonialReminderService.use((testimonialReminderService) =>
              testimonialReminderService.getIntervalDays(),
            ),
          };
        }, adaptAdminErrors),
      )
      .handle(
        "saveTestimonialReminderInterval",
        Effect.fnUntraced(function* ({ payload }) {
          yield* TestimonialReminderService.use((testimonialReminderService) =>
            testimonialReminderService.setIntervalDays(payload.interval_days),
          );
          yield* TestimonialReminderService.use((testimonialReminderService) =>
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
          const testimonial = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.updateTestimonialApproval(
              auth.session.id,
              params.id,
              payload.is_approved,
            ),
          );
          if (testimonial.is_approved) {
            yield* TestimonialReminderService.use((testimonialReminderService) =>
              testimonialReminderService.clearReminderState(testimonial.user_id),
            );
          } else if (testimonial.role === "student" || testimonial.role === "parent") {
            yield* TestimonialReminderService.use((testimonialReminderService) =>
              testimonialReminderService.scheduleNextReminder(testimonial.user_id),
            );
          }
          return { success: true as const };
        }, adaptAdminErrors),
      ),
);
