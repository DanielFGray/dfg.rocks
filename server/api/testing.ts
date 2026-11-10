/**
 * Testing API -- server-side test helpers for E2E tests.
 * Enabled outside production so local development can use the helpers too.
 */
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Config, Effect, Layer, Schema as S } from "effect";
import {
  BadRequestErrorSchema,
  ConflictErrorSchema,
  InternalServerErrorSchema,
  NotFoundErrorSchema,
} from "../../shared/httpApiErrors.js";
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

const testingErrors = [
  BadRequestErrorSchema,
  NotFoundErrorSchema,
  ConflictErrorSchema,
  InternalServerErrorSchema,
] as const;

export const testingGroup = HttpApiGroup.make("testing")
  .add(
    HttpApiEndpoint.get("login", "/testing/login", {
      error: testingErrors,
      query: TestingLoginQuery,
    }),
  )
  .add(
    HttpApiEndpoint.get("testimonialReminder", "/testing/testimonial-reminder", {
      error: testingErrors,
      query: TestingTestimonialReminderQuery,
    }),
  )
  .add(HttpApiEndpoint.get("clear", "/testing/clear", { error: testingErrors }))
  .add(
    HttpApiEndpoint.post("seedCourse", "/testing/seed-course", {
      error: testingErrors,
      payload: SeedCoursePayload,
    }),
  )
  .add(
    HttpApiEndpoint.post("seedMaterial", "/testing/seed-material", {
      error: testingErrors,
      payload: SeedMaterialPayload,
    }),
  )
  .add(
    HttpApiEndpoint.get("assignMaterial", "/testing/assign-material", {
      error: testingErrors,
      query: TestingAssignMaterialQuery,
    }),
  )
  .add(
    HttpApiEndpoint.get("enroll", "/testing/enroll", {
      error: testingErrors,
      query: TestingEnrollQuery,
    }),
  )
  .add(
    HttpApiEndpoint.get("seedFamily", "/testing/seed-family", {
      error: testingErrors,
      query: TestingSeedFamilyQuery,
    }),
  )
  .add(
    HttpApiEndpoint.get("seedFamilyMembership", "/testing/seed-family-membership", {
      error: testingErrors,
      query: TestingSeedFamilyMembershipQuery,
    }),
  )
  .add(
    HttpApiEndpoint.get("seedInvitation", "/testing/seed-invitation", {
      error: testingErrors,
      query: TestingSeedInvitationQuery,
    }),
  )
  .add(
    HttpApiEndpoint.get("seedDeleteAccount", "/testing/seed-delete-account", {
      error: testingErrors,
      query: TestingSeedDeleteAccountQuery,
    }),
  )
  .add(
    HttpApiEndpoint.get("seedLesson", "/testing/seed-lesson", {
      error: testingErrors,
      query: TestingSeedLessonQuery,
    }),
  )
  .prefix("/api");

const testingApi = HttpApi.make("dfg").add(testingGroup);

const testingErrorStatuses = [400, 404, 409, 500] as const;

// Testing endpoints intentionally return redirects or ad-hoc raw JSON responses.
const adaptTestingHandler = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, testingErrorStatuses).pipe(Effect.map(normalizeToResponse));

/** The testing API as its own router layer. app.ts imports this module only outside production. */
export const TestingHttpApiLive = HttpApiBuilder.layer(testingApi).pipe(
  Layer.provide(makeTestingLayer()),
  HttpRouter.provideRequest(TestingService.layer),
);

/** The testing routes create users and sessions at will, so they refuse to build in production. */
export class TestingApiInProductionError extends S.TaggedError<TestingApiInProductionError>()(
  "TestingApiInProductionError",
  {},
) {}

export function makeTestingLayer() {
  return Layer.unwrap(
    Effect.gen(function* () {
      if ((yield* Config.String("NODE_ENV")) === "production") {
        return yield* new TestingApiInProductionError();
      }
      return makeTestingGroupLayer();
    }),
  );
}

function makeTestingGroupLayer() {
  return HttpApiBuilder.group(testingApi, "testing", (handlers) =>
    handlers
      .handle(
        "login",
        Effect.fnUntraced(function* ({ query }) {
          const session = yield* TestingService.use((testingService) =>
            testingService.login({
              username: query.username,
              password: query.password,
              role: query.role,
              name: query.name,
              email: query.email,
            }),
          );
          let response = HttpServerResponse.redirect("/dashboard");
          response = yield* setSessionCookie(response, session.token, session.expiresAt);
          return response;
        }, adaptTestingHandler),
      )
      .handle(
        "testimonialReminder",
        Effect.fnUntraced(function* ({ query }) {
          yield* TestingService.use((testingService) =>
            testingService.setTestimonialReminder({
              username: query.username,
              promptEnabled: query.prompt_enabled ?? false,
              nextPromptAt: query.next_prompt_at ? new Date(query.next_prompt_at) : null,
            }),
          );
          return HttpServerResponse.redirect("/dashboard");
        }, adaptTestingHandler),
      )
      .handle(
        "clear",
        Effect.fnUntraced(function* () {
          yield* TestingService.use((testingService) => testingService.clear());
          return HttpServerResponse.redirect("/login");
        }, adaptTestingHandler),
      )
      .handle(
        "seedCourse",
        Effect.fnUntraced(function* ({ payload }) {
          const courseId = yield* TestingService.use((testingService) =>
            testingService.seedCourse(payload),
          );
          return HttpServerResponse.jsonUnsafe({ success: true, courseId });
        }, adaptTestingHandler),
      )
      .handle(
        "seedMaterial",
        Effect.fnUntraced(function* ({ payload }) {
          const materialId = yield* TestingService.use((testingService) =>
            testingService.seedMaterial(payload),
          );
          return HttpServerResponse.jsonUnsafe({ success: true, materialId });
        }, adaptTestingHandler),
      )
      .handle(
        "assignMaterial",
        Effect.fnUntraced(function* ({ query }) {
          const materialId = yield* TestingService.use((testingService) =>
            testingService.assignMaterial({
              username: query.username,
              materialTitle: query.material_title,
              assignedTrackIndex: query.assigned_track_index,
            }),
          );
          return HttpServerResponse.jsonUnsafe({ success: true, materialId });
        }, adaptTestingHandler),
      )
      .handle(
        "enroll",
        Effect.fnUntraced(function* ({ query }) {
          const courseId = yield* TestingService.use((testingService) =>
            testingService.enroll({
              username: query.username,
              courseTitle: query.course_title,
            }),
          );
          return HttpServerResponse.jsonUnsafe({ success: true, courseId });
        }, adaptTestingHandler),
      )
      .handle(
        "seedFamily",
        Effect.fnUntraced(function* ({ query }) {
          yield* TestingService.use((testingService) =>
            testingService.seedFamily({
              slug: query.slug,
              name: query.name,
              ownerUsername: query.owner_username,
            }),
          );
          return HttpServerResponse.jsonUnsafe({ success: true });
        }, adaptTestingHandler),
      )
      .handle(
        "seedFamilyMembership",
        Effect.fnUntraced(function* ({ query }) {
          yield* TestingService.use((testingService) =>
            testingService.seedFamilyMembership({
              username: query.username,
              familySlug: query.family_slug,
              isOwner: query.is_owner ?? false,
              isBillingContact: query.is_billing_contact ?? false,
            }),
          );
          return HttpServerResponse.jsonUnsafe({ success: true });
        }, adaptTestingHandler),
      )
      .handle(
        "seedInvitation",
        Effect.fnUntraced(function* ({ query }) {
          const invitation = yield* TestingService.use((testingService) =>
            testingService.seedInvitation({
              email: query.email,
              familySlug: query.family_slug,
              invitedRole: query.invited_role,
              expiresAt: query.expires_at ? new Date(query.expires_at) : undefined,
            }),
          );
          return HttpServerResponse.redirect(
            `/accept-invite?id=${invitation.invitationId}&code=${invitation.code}`,
          );
        }, adaptTestingHandler),
      )
      .handle(
        "seedDeleteAccount",
        Effect.fnUntraced(function* ({ query }) {
          const token = yield* TestingService.use((testingService) =>
            testingService.seedDeleteAccount(query.username),
          );
          return HttpServerResponse.redirect(`/confirm-delete-account?token=${token}`);
        }, adaptTestingHandler),
      )
      .handle(
        "seedLesson",
        Effect.fnUntraced(function* ({ query }) {
          yield* TestingService.use((testingService) =>
            testingService.seedLesson({
              username: query.username,
              scheduledAt: query.scheduled_at,
              durationMinutes: query.duration_minutes ?? 60,
              locationType: query.location_type ?? "online",
              status: query.status ?? "scheduled",
            }),
          );
          return HttpServerResponse.jsonUnsafe({ success: true });
        }, adaptTestingHandler),
      ),
  );
}
