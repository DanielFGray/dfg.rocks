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
import type { LessonStatus, LocationType } from "../../shared/schemas.js";

if (env.NODE_ENV === "production") throw new Error("testing API must not be enabled in production");

disableRateLimiting();

type LoginParams = {
  username?: string;
  password?: string;
  role?: "admin" | "teacher" | "student";
  name?: string;
  email?: string;
};

function boolQuery(value: string | null): boolean {
  return value === "true";
}

function numberQuery(value: string | null, fallback: number): number {
  return value ? Number(value) : fallback;
}

export const testingGroup = HttpApiGroup.make("testing")
  .add(HttpApiEndpoint.get("login", "/testing/login"))
  .add(HttpApiEndpoint.get("testimonialReminder", "/testing/testimonial-reminder"))
  .add(HttpApiEndpoint.get("clear", "/testing/clear"))
  .add(HttpApiEndpoint.post("seedCourse", "/testing/seed-course"))
  .add(HttpApiEndpoint.post("seedMaterial", "/testing/seed-material"))
  .add(HttpApiEndpoint.get("assignMaterial", "/testing/assign-material"))
  .add(HttpApiEndpoint.get("enroll", "/testing/enroll"))
  .add(HttpApiEndpoint.get("seedFamily", "/testing/seed-family"))
  .add(HttpApiEndpoint.get("seedFamilyMembership", "/testing/seed-family-membership"))
  .add(HttpApiEndpoint.get("seedInvitation", "/testing/seed-invitation"))
  .add(HttpApiEndpoint.get("seedDeleteAccount", "/testing/seed-delete-account"))
  .add(HttpApiEndpoint.get("seedLesson", "/testing/seed-lesson"))
  .prefix("/api");

const testingApi = HttpApi.make("dfg").add(testingGroup);

export function makeTestingLayer() {
  return HttpApiBuilder.group(testingApi, "testing", (handlers) =>
    handlers
      .handleRaw(
        "login",
        Effect.fnUntraced(
          function* ({ request }) {
            const webRequest = request.source as Request;
            const query = new URL(webRequest.url).searchParams;
            const session = yield* (yield* TestingService).login({
              username: query.get("username") ?? undefined,
              password: query.get("password") ?? undefined,
              role: (query.get("role") as LoginParams["role"]) ?? undefined,
              name: query.get("name") ?? undefined,
              email: query.get("email") ?? undefined,
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
      .handleRaw(
        "testimonialReminder",
        Effect.fnUntraced(
          function* ({ request }) {
            const webRequest = request.source as Request;
            const query = new URL(webRequest.url).searchParams;
            const username = query.get("username");
            if (!username) {
              return yield* new HttpError(400, "username is required");
            }
            yield* (yield* TestingService).setTestimonialReminder({
              username,
              promptEnabled: boolQuery(query.get("prompt_enabled")),
              nextPromptAt: query.get("next_prompt_at")
                ? new Date(query.get("next_prompt_at")!)
                : null,
            });
            return HttpServerResponse.redirect(new URL("/dashboard", webRequest.url).toString());
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handleRaw(
        "clear",
        Effect.fnUntraced(
          function* ({ request }) {
            const webRequest = request.source as Request;
            yield* (yield* TestingService).clear();
            return HttpServerResponse.redirect(new URL("/login", webRequest.url).toString());
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handleRaw(
        "seedCourse",
        Effect.fnUntraced(
          function* ({ request }) {
            const webRequest = request.source as Request;
            const body = (yield* Effect.tryPromise({
              try: () =>
                webRequest.json() as Promise<{
                  title: string;
                  instrument: string;
                  description?: string;
                  modules?: Array<{
                    title: string;
                    sort_order?: number;
                  }>;
                }>,
              catch: (error) => error,
            })) as {
              title: string;
              instrument: string;
              description?: string;
              modules?: Array<{
                title: string;
                sort_order?: number;
              }>;
            };
            const courseId = yield* (yield* TestingService).seedCourse(body);
            return HttpServerResponse.redirect(
              new URL(`/courses/${courseId}`, webRequest.url).toString(),
            );
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handleRaw(
        "seedMaterial",
        Effect.fnUntraced(
          function* ({ request }) {
            const webRequest = request.source as Request;
            const body = (yield* Effect.tryPromise({
              try: () =>
                webRequest.json() as Promise<{
                  title: string;
                  original_filename?: string;
                  mime_type?: string;
                  file_size?: number;
                  is_global?: boolean;
                  source_file_path?: string;
                }>,
              catch: (error) => error,
            })) as {
              title: string;
              original_filename?: string;
              mime_type?: string;
              file_size?: number;
              is_global?: boolean;
              source_file_path?: string;
            };
            const materialId = yield* (yield* TestingService).seedMaterial(body);
            return HttpServerResponse.redirect(
              new URL(`/library#${materialId}`, webRequest.url).toString(),
            );
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handleRaw(
        "assignMaterial",
        Effect.fnUntraced(
          function* ({ request }) {
            const webRequest = request.source as Request;
            const query = new URL(webRequest.url).searchParams;
            const username = query.get("username");
            const materialTitle = query.get("material_title");
            if (!username || !materialTitle) {
              return yield* new HttpError(400, "username and material_title are required");
            }
            const materialId = yield* (yield* TestingService).assignMaterial({
              username,
              materialTitle,
              assignedTrackIndex: query.get("assigned_track_index"),
            });
            return HttpServerResponse.redirect(
              new URL(`/assignments#${materialId}`, webRequest.url).toString(),
            );
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handleRaw(
        "enroll",
        Effect.fnUntraced(
          function* ({ request }) {
            const webRequest = request.source as Request;
            const query = new URL(webRequest.url).searchParams;
            const username = query.get("username");
            const courseTitle = query.get("course_title");
            if (!username || !courseTitle) {
              return yield* new HttpError(400, "username and course_title are required");
            }
            const courseId = yield* (yield* TestingService).enroll({
              username,
              courseTitle,
            });
            return HttpServerResponse.redirect(
              new URL(`/courses/${courseId}`, webRequest.url).toString(),
            );
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handleRaw(
        "seedFamily",
        Effect.fnUntraced(
          function* ({ request }) {
            const webRequest = request.source as Request;
            const query = new URL(webRequest.url).searchParams;
            yield* (yield* TestingService).seedFamily({
              slug: query.get("slug"),
              name: query.get("name"),
              ownerUsername: query.get("owner_username"),
            });
            return HttpServerResponse.redirect(new URL("/students", webRequest.url).toString());
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handleRaw(
        "seedFamilyMembership",
        Effect.fnUntraced(
          function* ({ request }) {
            const webRequest = request.source as Request;
            const query = new URL(webRequest.url).searchParams;
            const username = query.get("username");
            const familySlug = query.get("family_slug");
            if (!username || !familySlug) {
              return yield* new HttpError(400, "username and family_slug are required");
            }
            yield* (yield* TestingService).seedFamilyMembership({
              username,
              familySlug,
              isOwner: boolQuery(query.get("is_owner")),
              isBillingContact: boolQuery(query.get("is_billing_contact")),
            });
            return HttpServerResponse.redirect(new URL("/students", webRequest.url).toString());
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handleRaw(
        "seedInvitation",
        Effect.fnUntraced(
          function* ({ request }) {
            const webRequest = request.source as Request;
            const query = new URL(webRequest.url).searchParams;
            const email = query.get("email");
            if (!email) {
              return yield* new HttpError(400, "email is required");
            }
            const invitation = yield* (yield* TestingService).seedInvitation({
              email,
              familySlug: query.get("family_slug"),
              expiresAt: query.get("expires_at") ? new Date(query.get("expires_at")!) : undefined,
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
      .handleRaw(
        "seedDeleteAccount",
        Effect.fnUntraced(
          function* ({ request }) {
            const webRequest = request.source as Request;
            const query = new URL(webRequest.url).searchParams;
            const username = query.get("username");
            if (!username) {
              return yield* new HttpError(400, "username is required");
            }
            const token = yield* (yield* TestingService).seedDeleteAccount(username);
            return HttpServerResponse.redirect(
              new URL(`/confirm-delete-account?token=${token}`, webRequest.url).toString(),
            );
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handleRaw(
        "seedLesson",
        Effect.fnUntraced(
          function* ({ request }) {
            const webRequest = request.source as Request;
            const query = new URL(webRequest.url).searchParams;
            const username = query.get("username");
            if (!username) {
              return yield* new HttpError(400, "username is required");
            }
            yield* (yield* TestingService).seedLesson({
              username,
              scheduledAt: query.get("scheduled_at"),
              durationMinutes: numberQuery(query.get("duration_minutes"), 60),
              locationType: (query.get("location_type") ?? "online") as LocationType,
              status: (query.get("status") ?? "scheduled") as LessonStatus,
            });
            return HttpServerResponse.redirect(new URL("/my-lessons", webRequest.url).toString());
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      ),
  );
}
