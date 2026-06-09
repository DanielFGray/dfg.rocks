/**
 * Testing API -- server-side test helpers for E2E tests.
 * Enabled outside production so local development can use the helpers too.
 */
import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Effect } from "effect";
import { env } from "../assertEnv.js";
import { HttpError } from "../pgErrors.js";
import { disableRateLimiting } from "../services/rateLimiter.js";
import { TestingService } from "../services/testingService.js";
import { setSessionCookie, normalizeToResponse, responseForCause } from "./raw.js";
import {
  TestingLoginQuery,
  TestingTestimonialReminderQuery,
  SeedCoursePayload,
  SeedMaterialPayload,
  TestingAssignMaterialQuery,
  TestingEnrollQuery,
  TestingSeedFamilyQuery,
  TestingSeedFamilyMembershipQuery,
  TestingSeedInvitationQuery,
  TestingSeedDeleteAccountQuery,
  TestingSeedLessonQuery,
} from "../../shared/httpApi.js";

if (env.NODE_ENV === "production") throw new Error("testing API must not be enabled in production");

disableRateLimiting();

export const testingGroup = HttpApiGroup.make("testing")
  .add(HttpApiEndpoint.get("login", "/testing/login").setUrlParams(TestingLoginQuery))
  .add(HttpApiEndpoint.get("testimonialReminder", "/testing/testimonial-reminder").setUrlParams(TestingTestimonialReminderQuery))
  .add(HttpApiEndpoint.get("clear", "/testing/clear"))
  .add(HttpApiEndpoint.post("seedCourse", "/testing/seed-course").setPayload(SeedCoursePayload))
  .add(HttpApiEndpoint.post("seedMaterial", "/testing/seed-material").setPayload(SeedMaterialPayload))
  .add(HttpApiEndpoint.get("assignMaterial", "/testing/assign-material").setUrlParams(TestingAssignMaterialQuery))
  .add(HttpApiEndpoint.get("enroll", "/testing/enroll").setUrlParams(TestingEnrollQuery))
  .add(HttpApiEndpoint.get("seedFamily", "/testing/seed-family").setUrlParams(TestingSeedFamilyQuery))
  .add(HttpApiEndpoint.get("seedFamilyMembership", "/testing/seed-family-membership").setUrlParams(TestingSeedFamilyMembershipQuery))
  .add(HttpApiEndpoint.get("seedInvitation", "/testing/seed-invitation").setUrlParams(TestingSeedInvitationQuery))
  .add(HttpApiEndpoint.get("seedDeleteAccount", "/testing/seed-delete-account").setUrlParams(TestingSeedDeleteAccountQuery))
  .add(HttpApiEndpoint.get("seedLesson", "/testing/seed-lesson").setUrlParams(TestingSeedLessonQuery))
  .prefix("/api");

const testingApi = HttpApi.make("dfg").add(testingGroup);

export function makeTestingLayer() {
  return HttpApiBuilder.group(testingApi, "testing", (handlers) =>
    handlers
      .handle(
        "login",
        Effect.fnUntraced(
          function* ({ request, urlParams }) {
            const webRequest = request.source as Request;
            const session = yield* TestingService.login({
              username: urlParams.username,
              password: urlParams.password,
              role: urlParams.role,
              name: urlParams.name,
              email: urlParams.email,
            });
            let response = HttpServerResponse.redirect(
              new URL("/dashboard", webRequest.url).toString(),
            );
            response = setSessionCookie(response, session.token, session.expiresAt);
            return response;
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "testimonialReminder",
        Effect.fnUntraced(
          function* ({ request, urlParams }) {
            const webRequest = request.source as Request;
            yield* TestingService.setTestimonialReminder({
              username: urlParams.username,
              promptEnabled: urlParams.prompt_enabled ?? false,
              nextPromptAt: urlParams.next_prompt_at ? new Date(urlParams.next_prompt_at) : null,
            });
            return HttpServerResponse.redirect(new URL("/dashboard", webRequest.url).toString());
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "clear",
        Effect.fnUntraced(
          function* ({ request }) {
            const webRequest = request.source as Request;
            yield* TestingService.clear();
            return HttpServerResponse.redirect(new URL("/login", webRequest.url).toString());
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "seedCourse",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            const courseId = yield* TestingService.seedCourse(payload);
            return HttpServerResponse.redirect(
              new URL(`/courses/${courseId}`, (request.source as Request).url).toString(),
            );
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "seedMaterial",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            const materialId = yield* TestingService.seedMaterial(payload);
            return HttpServerResponse.redirect(
              new URL(`/library#${materialId}`, (request.source as Request).url).toString(),
            );
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "assignMaterial",
        Effect.fnUntraced(
          function* ({ request, urlParams }) {
            const webRequest = request.source as Request;
            const materialId = yield* TestingService.assignMaterial({
              username: urlParams.username,
              materialTitle: urlParams.material_title,
              assignedTrackIndex: urlParams.assigned_track_index,
            });
            return HttpServerResponse.redirect(
              new URL(`/assignments#${materialId}`, webRequest.url).toString(),
            );
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "enroll",
        Effect.fnUntraced(
          function* ({ request, urlParams }) {
            const webRequest = request.source as Request;
            const courseId = yield* TestingService.enroll({
              username: urlParams.username,
              courseTitle: urlParams.course_title,
            });
            return HttpServerResponse.redirect(
              new URL(`/courses/${courseId}`, webRequest.url).toString(),
            );
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "seedFamily",
        Effect.fnUntraced(
          function* ({ request, urlParams }) {
            const webRequest = request.source as Request;
            yield* TestingService.seedFamily({
              slug: urlParams.slug,
              name: urlParams.name,
              ownerUsername: urlParams.owner_username,
            });
            return HttpServerResponse.redirect(new URL("/students", webRequest.url).toString());
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "seedFamilyMembership",
        Effect.fnUntraced(
          function* ({ request, urlParams }) {
            const webRequest = request.source as Request;
            yield* TestingService.seedFamilyMembership({
              username: urlParams.username,
              familySlug: urlParams.family_slug,
              isOwner: urlParams.is_owner ?? false,
              isBillingContact: urlParams.is_billing_contact ?? false,
            });
            return HttpServerResponse.redirect(new URL("/students", webRequest.url).toString());
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "seedInvitation",
        Effect.fnUntraced(
          function* ({ request, urlParams }) {
            const webRequest = request.source as Request;
            const invitation = yield* TestingService.seedInvitation({
              email: urlParams.email,
              familySlug: urlParams.family_slug,
              expiresAt: urlParams.expires_at ? new Date(urlParams.expires_at) : undefined,
            });
            return HttpServerResponse.redirect(
              new URL(
                `/accept-invite?id=${invitation.invitationId}&code=${invitation.code}`,
                webRequest.url,
              ).toString(),
            );
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "seedDeleteAccount",
        Effect.fnUntraced(
          function* ({ request, urlParams }) {
            const webRequest = request.source as Request;
            const token = yield* TestingService.seedDeleteAccount(urlParams.username);
            return HttpServerResponse.redirect(
              new URL(`/confirm-delete-account?token=${token}`, webRequest.url).toString(),
            );
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "seedLesson",
        Effect.fnUntraced(
          function* ({ request, urlParams }) {
            const webRequest = request.source as Request;
            yield* TestingService.seedLesson({
              username: urlParams.username,
              scheduledAt: urlParams.scheduled_at,
              durationMinutes: urlParams.duration_minutes ?? 60,
              locationType: urlParams.location_type ?? "online",
              status: urlParams.status ?? "scheduled",
            });
            return HttpServerResponse.redirect(new URL("/my-lessons", webRequest.url).toString());
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      ),
  );
}
