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
import {
  BadRequestErrorSchema,
  ConflictErrorSchema,
  InternalServerErrorSchema,
  NotFoundErrorSchema,
} from "../../shared/httpApiErrors.js";
import { env } from "../assertEnv.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { TestingService } from "../services/testingService.js";
import { normalizeToResponse, setSessionCookie } from "./raw.js";
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

export const testingGroup = HttpApiGroup.make("testing")
  .addError(BadRequestErrorSchema)
  .addError(NotFoundErrorSchema)
  .addError(ConflictErrorSchema)
  .addError(InternalServerErrorSchema)
  .add(HttpApiEndpoint.get("login", "/testing/login").setUrlParams(TestingLoginQuery))
  .add(
    HttpApiEndpoint.get("testimonialReminder", "/testing/testimonial-reminder").setUrlParams(
      TestingTestimonialReminderQuery,
    ),
  )
  .add(HttpApiEndpoint.get("clear", "/testing/clear"))
  .add(HttpApiEndpoint.post("seedCourse", "/testing/seed-course").setPayload(SeedCoursePayload))
  .add(
    HttpApiEndpoint.post("seedMaterial", "/testing/seed-material").setPayload(SeedMaterialPayload),
  )
  .add(
    HttpApiEndpoint.get("assignMaterial", "/testing/assign-material").setUrlParams(
      TestingAssignMaterialQuery,
    ),
  )
  .add(HttpApiEndpoint.get("enroll", "/testing/enroll").setUrlParams(TestingEnrollQuery))
  .add(
    HttpApiEndpoint.get("seedFamily", "/testing/seed-family").setUrlParams(TestingSeedFamilyQuery),
  )
  .add(
    HttpApiEndpoint.get("seedFamilyMembership", "/testing/seed-family-membership").setUrlParams(
      TestingSeedFamilyMembershipQuery,
    ),
  )
  .add(
    HttpApiEndpoint.get("seedInvitation", "/testing/seed-invitation").setUrlParams(
      TestingSeedInvitationQuery,
    ),
  )
  .add(
    HttpApiEndpoint.get("seedDeleteAccount", "/testing/seed-delete-account").setUrlParams(
      TestingSeedDeleteAccountQuery,
    ),
  )
  .add(
    HttpApiEndpoint.get("seedLesson", "/testing/seed-lesson").setUrlParams(TestingSeedLessonQuery),
  )
  .prefix("/api");

const testingApi = HttpApi.make("dfg").add(testingGroup);

const testingErrorStatuses = [400, 404, 409, 500] as const;

// Testing endpoints intentionally return redirects or ad-hoc raw JSON responses.
const adaptTestingHandler = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, testingErrorStatuses).pipe(
    Effect.map(normalizeToResponse),
  );

export function makeTestingLayer() {
  return HttpApiBuilder.group(testingApi, "testing", (handlers) =>
    handlers
      .handle(
        "login",
        Effect.fnUntraced(function* ({ urlParams }) {
          const session = yield* TestingService.login({
            username: urlParams.username,
            password: urlParams.password,
            role: urlParams.role,
            name: urlParams.name,
            email: urlParams.email,
          });
          let response = HttpServerResponse.redirect("/dashboard");
          response = yield* setSessionCookie(response, session.token, session.expiresAt);
          return response;
        }, adaptTestingHandler),
      )
      .handle(
        "testimonialReminder",
        Effect.fnUntraced(function* ({ urlParams }) {
          yield* TestingService.setTestimonialReminder({
            username: urlParams.username,
            promptEnabled: urlParams.prompt_enabled ?? false,
            nextPromptAt: urlParams.next_prompt_at ? new Date(urlParams.next_prompt_at) : null,
          });
          return HttpServerResponse.redirect("/dashboard");
        }, adaptTestingHandler),
      )
      .handle(
        "clear",
        Effect.fnUntraced(function* () {
          yield* TestingService.clear();
          return HttpServerResponse.redirect("/login");
        }, adaptTestingHandler),
      )
      .handle(
        "seedCourse",
        Effect.fnUntraced(function* ({ payload }) {
          const courseId = yield* TestingService.seedCourse(payload);
          return HttpServerResponse.unsafeJson({ success: true, courseId });
        }, adaptTestingHandler),
      )
      .handle(
        "seedMaterial",
        Effect.fnUntraced(function* ({ payload }) {
          const materialId = yield* TestingService.seedMaterial(payload);
          return HttpServerResponse.unsafeJson({ success: true, materialId });
        }, adaptTestingHandler),
      )
      .handle(
        "assignMaterial",
        Effect.fnUntraced(function* ({ urlParams }) {
          const materialId = yield* TestingService.assignMaterial({
            username: urlParams.username,
            materialTitle: urlParams.material_title,
            assignedTrackIndex: urlParams.assigned_track_index,
          });
          return HttpServerResponse.unsafeJson({ success: true, materialId });
        }, adaptTestingHandler),
      )
      .handle(
        "enroll",
        Effect.fnUntraced(function* ({ urlParams }) {
          const courseId = yield* TestingService.enroll({
            username: urlParams.username,
            courseTitle: urlParams.course_title,
          });
          return HttpServerResponse.unsafeJson({ success: true, courseId });
        }, adaptTestingHandler),
      )
      .handle(
        "seedFamily",
        Effect.fnUntraced(function* ({ urlParams }) {
          yield* TestingService.seedFamily({
            slug: urlParams.slug,
            name: urlParams.name,
            ownerUsername: urlParams.owner_username,
          });
          return HttpServerResponse.unsafeJson({ success: true });
        }, adaptTestingHandler),
      )
      .handle(
        "seedFamilyMembership",
        Effect.fnUntraced(function* ({ urlParams }) {
          yield* TestingService.seedFamilyMembership({
            username: urlParams.username,
            familySlug: urlParams.family_slug,
            isOwner: urlParams.is_owner ?? false,
            isBillingContact: urlParams.is_billing_contact ?? false,
          });
          return HttpServerResponse.unsafeJson({ success: true });
        }, adaptTestingHandler),
      )
      .handle(
        "seedInvitation",
        Effect.fnUntraced(function* ({ urlParams }) {
          const invitation = yield* TestingService.seedInvitation({
            email: urlParams.email,
            familySlug: urlParams.family_slug,
            invitedRole: urlParams.invited_role,
            expiresAt: urlParams.expires_at ? new Date(urlParams.expires_at) : undefined,
          });
          return HttpServerResponse.redirect(
            `/accept-invite?id=${invitation.invitationId}&code=${invitation.code}`,
          );
        }, adaptTestingHandler),
      )
      .handle(
        "seedDeleteAccount",
        Effect.fnUntraced(function* ({ urlParams }) {
          const token = yield* TestingService.seedDeleteAccount(urlParams.username);
          return HttpServerResponse.redirect(`/confirm-delete-account?token=${token}`);
        }, adaptTestingHandler),
      )
      .handle(
        "seedLesson",
        Effect.fnUntraced(function* ({ urlParams }) {
          yield* TestingService.seedLesson({
            username: urlParams.username,
            scheduledAt: urlParams.scheduled_at,
            durationMinutes: urlParams.duration_minutes ?? 60,
            locationType: urlParams.location_type ?? "online",
            status: urlParams.status ?? "scheduled",
          });
          return HttpServerResponse.unsafeJson({ success: true });
        }, adaptTestingHandler),
      ),
  );
}
