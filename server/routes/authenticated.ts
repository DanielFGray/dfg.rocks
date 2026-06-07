import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Effect, Stream } from "effect";
import {
  authenticatedClientGroup,
  type AuthenticatedClientEndpoint,
} from "../../shared/httpApi.js";
import { HttpError } from "../pgErrors.js";
import { realtimeBus, type RealtimeMessage } from "../services/realtimeBus.js";
import { AuthenticatedRouteService } from "../services/authenticatedRouteService.js";
import { GoogleCalendarService } from "../services/googleCalendarService.js";
import { SessionService, type SessionResult } from "../services/sessionService.js";
import {
  csrfCheck,
  expireSessionCookie,
  params,
  type RawRequest,
  normalizeToResponse,
  responseForCause,
} from "./raw.js";

type Auth = NonNullable<SessionResult>;

const testimonialRoleLabels = {
  admin: "Admin",
  parent: "Parent",
  student: "Student",
  teacher: "Teacher",
} as const;

const normalizeTestimonialBody = Effect.fnUntraced(function* (body: string) {
  const normalized = body.trim();
  if (normalized.length < 20) {
    return yield* HttpError.make(400, "Testimonial must be at least 20 characters");
  }
  if (normalized.length > 2000) {
    return yield* HttpError.make(400, "Testimonial must be 2000 characters or less");
  }
  return normalized;
});

const assertCanManageTestimonial = Effect.fnUntraced(function* (auth: Auth) {
  if (auth.user.role === "admin") {
    return yield* HttpError.make(403, "Admins cannot manage testimonials");
  }
});

const assertCanManageAssignments = Effect.fnUntraced(function* (auth: Auth) {
  if (auth.user.role !== "admin" && auth.user.role !== "teacher") {
    return yield* HttpError.make(403, "Forbidden");
  }
});

const assertCanTrackOwnAssignments = Effect.fnUntraced(function* (auth: Auth) {
  if (auth.user.role !== "student") {
    return yield* HttpError.make(403, "Forbidden");
  }
});

function serializeTestimonial(testimonial: {
  id: string;
  user_id: string;
  body: string;
  is_approved: boolean;
  username: string;
  name: string | null;
  role: "admin" | "student" | "parent" | "teacher";
  created_at: Date | string;
  updated_at: Date | string;
}) {
  return {
    id: testimonial.id,
    user_id: testimonial.user_id,
    body: testimonial.body,
    display_name: testimonial.name?.trim() || testimonial.username,
    role_label: testimonialRoleLabels[testimonial.role],
    is_approved: testimonial.is_approved,
    created_at:
      testimonial.created_at instanceof Date
        ? testimonial.created_at.toISOString()
        : testimonial.created_at,
    updated_at:
      testimonial.updated_at instanceof Date
        ? testimonial.updated_at.toISOString()
        : testimonial.updated_at,
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value ? toIso(value) : null;
}

function serializeLesson<
  T extends {
    scheduled_at: Date | string;
    cancelled_at: Date | string | null;
    completed_at: Date | string | null;
    created_at: Date | string;
  },
>(lesson: T) {
  return {
    ...lesson,
    scheduled_at: toIso(lesson.scheduled_at),
    cancelled_at: toIsoOrNull(lesson.cancelled_at),
    completed_at: toIsoOrNull(lesson.completed_at),
    created_at: toIso(lesson.created_at),
  };
}

function requireAuth(request: RawRequest) {
  return Effect.flatMap(SessionService.validateSessionToken(request.cookies.session), (auth) =>
    auth ? Effect.succeed(auth) : HttpError.make(401, "Unauthorized"),
  );
}

const createPracticeLog = HttpApiEndpoint.post("createPracticeLog", "/api/practice-logs");
const myLessonById = HttpApiEndpoint.get("myLessonById", "/api/my-lessons/:id").setPath(
  params("id"),
);
const requestDeleteAccount = HttpApiEndpoint.post(
  "requestDeleteAccount",
  "/api/request-delete-account",
);
const myLessonNotes = HttpApiEndpoint.get("myLessonNotes", "/api/my-lessons/:id/notes").setPath(
  params("id"),
);
const testimonials = HttpApiEndpoint.get("testimonials", "/api/testimonials");
const events = HttpApiEndpoint.get("events", "/api/events");

type AuthenticatedEndpoint =
  | AuthenticatedClientEndpoint
  | typeof createPracticeLog
  | typeof myLessonById
  | typeof requestDeleteAccount
  | typeof myLessonNotes
  | typeof testimonials
  | typeof events;

type AuthenticatedRawRequest<
  Name extends HttpApiEndpoint.HttpApiEndpoint.Name<AuthenticatedEndpoint>,
> = Parameters<
  HttpApiEndpoint.HttpApiEndpoint.HandlerRawWithName<AuthenticatedEndpoint, Name, never, never>
>[0];

export const authenticatedGroup = authenticatedClientGroup
  .add(createPracticeLog)
  .add(myLessonById)
  .add(requestDeleteAccount)
  .add(myLessonNotes)
  .add(testimonials)
  .add(events);

const authenticatedApi = HttpApi.make("dfg").add(authenticatedGroup);
export function makeAuthenticatedLayer() {
  return HttpApiBuilder.group(authenticatedApi, "authenticated", (handlers) =>
    handlers
      .handle(
        "courses",
        Effect.fnUntraced(
          function* ({ request }) {
            const auth = yield* requireAuth(request);
            return yield* AuthenticatedRouteService.courses(auth.session.id);
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "courseById",
        Effect.fnUntraced(
          function* ({ request, path }: AuthenticatedRawRequest<"courseById">) {
            const auth = yield* requireAuth(request);
            return yield* AuthenticatedRouteService.courseById(auth.session.id, path.id);
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "library",
        Effect.fnUntraced(
          function* ({ request }) {
            const query = new URL((request.source as Request).url).searchParams;
            const limit = Number.parseInt(query.get("limit") ?? "", 10);
            const offset = Number.parseInt(query.get("offset") ?? "", 10);
            const auth = yield* requireAuth(request);
            return yield* AuthenticatedRouteService.library(auth.session.id, {
              limit: Number.isFinite(limit) ? limit : 50,
              offset: Number.isFinite(offset) ? offset : 0,
            });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "assignments",
        Effect.fnUntraced(
          function* ({ request }) {
            const auth = yield* requireAuth(request);
            return yield* AuthenticatedRouteService.assignments(auth.session.id);
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "assignStudentMaterial",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            const auth = yield* requireAuth(request);
            yield* assertCanManageAssignments(auth);
            yield* AuthenticatedRouteService.assignStudentMaterial({
              studentId: path.studentId,
              materialId: payload.material_id,
              assignedTrackIndex: payload.assigned_track_index,
            });
            return { success: true as const };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "unassignStudentMaterial",
        Effect.fnUntraced(
          function* ({ request, path }: AuthenticatedRawRequest<"unassignStudentMaterial">) {
            const auth = yield* requireAuth(request);
            yield* assertCanManageAssignments(auth);
            yield* AuthenticatedRouteService.unassignStudentMaterial(
              path.studentId,
              path.materialId,
            );
            return { success: true as const };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "practiceLogs",
        Effect.fnUntraced(
          function* ({ request }) {
            const query = new URL((request.source as Request).url).searchParams;
            const materialId = query.get("material_id") ?? undefined;
            const auth = yield* requireAuth(request);
            const rows = yield* AuthenticatedRouteService.practiceLogs(auth.session.id, materialId);
            return rows.map((row) => ({
              ...row,
              logged_at: row.logged_at.toISOString(),
            }));
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "createPracticeLog",
        Effect.fnUntraced(
          function* ({ request }) {
            const body = yield* Effect.tryPromise({
              try: () =>
                (request.source as Request).json() as Promise<{
                  material_id: string;
                  status: "practiced" | "completed";
                  notes?: string;
                }>,
              catch: (e) => e,
            });
            const auth = yield* requireAuth(request);
            const row = yield* AuthenticatedRouteService.createPracticeLog({
              sessionId: auth.session.id,
              studentId: auth.user.id,
              materialId: body.material_id,
              status: body.status,
              notes: body.notes,
            });
            return {
              ...row,
              logged_at: row.logged_at.toISOString(),
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "recordAssignmentPlayback",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            const auth = yield* requireAuth(request);
            yield* assertCanTrackOwnAssignments(auth);
            const row = yield* AuthenticatedRouteService.recordAssignmentPlayback({
              sessionId: auth.session.id,
              studentId: auth.user.id,
              materialId: path.materialId,
              seconds: payload.seconds,
            });
            return {
              ...row,
              updated_at: row.updated_at.toISOString(),
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "createAssignmentReview",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            const auth = yield* requireAuth(request);
            yield* assertCanTrackOwnAssignments(auth);
            const row = yield* AuthenticatedRouteService.createAssignmentReview({
              sessionId: auth.session.id,
              studentId: auth.user.id,
              materialId: path.materialId,
              stars: payload.stars,
            });
            return {
              ...row,
              created_at: row.created_at.toISOString(),
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "assignmentNotes",
        Effect.fnUntraced(
          function* ({ request, path }: AuthenticatedRawRequest<"assignmentNotes">) {
            const auth = yield* requireAuth(request);
            const row = yield* AuthenticatedRouteService.assignmentNotes(
              auth.session.id,
              path.materialId,
            );
            if (!row) {
              return null;
            }
            return {
              ...row,
              created_at: row.created_at.toISOString(),
              updated_at: row.updated_at.toISOString(),
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "upsertAssignmentNotes",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            const auth = yield* requireAuth(request);
            const row = yield* AuthenticatedRouteService.upsertAssignmentNotes({
              sessionId: auth.session.id,
              studentId: auth.user.id,
              materialId: path.materialId,
              body: payload.body,
            });
            return {
              ...row,
              created_at: row.created_at.toISOString(),
              updated_at: row.updated_at.toISOString(),
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "messages",
        Effect.fnUntraced(
          function* ({ request }) {
            const query = new URL((request.source as Request).url).searchParams;
            const limit = Number.parseInt(query.get("limit") ?? "", 10);
            const offset = Number.parseInt(query.get("offset") ?? "", 10);
            const withUser = query.get("with") ?? undefined;
            const auth = yield* requireAuth(request);
            const rows = yield* AuthenticatedRouteService.messages(auth.session.id, {
              limit: Number.isFinite(limit) ? limit : 50,
              offset: Number.isFinite(offset) ? offset : 0,
              withUser,
            });
            return rows.map((row) => ({
              ...row,
              created_at: row.created_at.toISOString(),
            }));
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "createMessage",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            const auth = yield* requireAuth(request);
            const row = yield* AuthenticatedRouteService.createMessage({
              sessionId: auth.session.id,
              senderId: auth.user.id,
              recipientId: payload.recipient_id,
              body: payload.body,
            });
            return {
              ...row,
              created_at: row.created_at.toISOString(),
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "markMessageRead",
        Effect.fnUntraced(
          function* ({ request, path }: AuthenticatedRawRequest<"markMessageRead">) {
            const auth = yield* requireAuth(request);
            yield* AuthenticatedRouteService.markMessageRead(auth.session.id, path.id);
            return { success: true as const };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "myLessons",
        Effect.fnUntraced(
          function* ({ request }) {
            const query = new URL((request.source as Request).url).searchParams;
            const limit = Number.parseInt(query.get("limit") ?? "", 10);
            const offset = Number.parseInt(query.get("offset") ?? "", 10);
            const status = query.get("status") ?? undefined;
            const from = query.get("from") ?? undefined;
            const to = query.get("to") ?? undefined;
            const auth = yield* requireAuth(request);
            const rows = yield* AuthenticatedRouteService.myLessons(auth.session.id, {
              limit: Number.isFinite(limit) ? limit : 50,
              offset: Number.isFinite(offset) ? offset : 0,
              status,
              from,
              to,
            });
            return rows.map((row) => serializeLesson(row));
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "myLessonById",
        Effect.fnUntraced(
          function* ({ request, path }: AuthenticatedRawRequest<"myLessonById">) {
            const auth = yield* requireAuth(request);
            const lesson = yield* AuthenticatedRouteService.myLessonById(auth.session.id, path.id);
            return serializeLesson(lesson);
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "requestDeleteAccount",
        Effect.fnUntraced(
          function* ({ request }) {
            const auth = yield* requireAuth(request);
            csrfCheck(request.headers);
            yield* AuthenticatedRouteService.requestDeleteAccount(auth.session.id);
            return { success: true as const };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "confirmDeleteAccount",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            const auth = yield* requireAuth(request);
            csrfCheck(request.headers);
            const deleted = yield* AuthenticatedRouteService.confirmDeleteAccount(
              auth.session.id,
              payload.token,
            );
            if (!deleted) {
              return yield* new HttpError(400, "Invalid or expired deletion token");
            }
            yield* SessionService.deleteAllUserSessions(auth.user.id);
            return expireSessionCookie(HttpServerResponse.unsafeJson({ success: true as const }));
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "myLessonNotes",
        Effect.fnUntraced(
          function* ({ request, path }: AuthenticatedRawRequest<"myLessonNotes">) {
            const auth = yield* requireAuth(request);
            const row = yield* AuthenticatedRouteService.myLessonNotes(auth.session.id, path.id);
            return {
              ...row,
              material_ids: row.material_ids ?? null,
              created_at: row.created_at.toISOString(),
              updated_at: row.updated_at.toISOString(),
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "myLessonNotesList",
        Effect.fnUntraced(
          function* ({ request }) {
            const query = new URL((request.source as Request).url).searchParams;
            const limit = Number.parseInt(query.get("limit") ?? "", 10);
            const offset = Number.parseInt(query.get("offset") ?? "", 10);
            const auth = yield* requireAuth(request);
            const rows = yield* AuthenticatedRouteService.myLessonNotesList(auth.session.id, {
              limit: Number.isFinite(limit) ? limit : 50,
              offset: Number.isFinite(offset) ? offset : 0,
            });
            return rows.map((row) => ({
              ...row,
              material_ids: row.material_ids ?? null,
              created_at: row.created_at.toISOString(),
              updated_at: row.updated_at.toISOString(),
            }));
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "myEmails",
        Effect.fnUntraced(
          function* ({ request }) {
            const auth = yield* requireAuth(request);
            const rows = yield* AuthenticatedRouteService.myEmails(auth.session.id);
            return rows.map((row) => ({
              ...row,
              created_at: row.created_at.toISOString(),
            }));
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "addMyEmail",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            const auth = yield* requireAuth(request);
            const row = yield* AuthenticatedRouteService.addMyEmail(auth.session.id, payload.email);
            return {
              ...row,
              created_at: row.created_at.toISOString(),
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "deleteMyEmail",
        Effect.fnUntraced(
          function* ({ request, path }: AuthenticatedRawRequest<"deleteMyEmail">) {
            const auth = yield* requireAuth(request);
            yield* AuthenticatedRouteService.deleteMyEmail(auth.session.id, path.id);
            return { success: true as const };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "makePrimaryEmail",
        Effect.fnUntraced(
          function* ({ request, path }: AuthenticatedRawRequest<"makePrimaryEmail">) {
            const auth = yield* requireAuth(request);
            const row = yield* AuthenticatedRouteService.makePrimaryEmail(auth.session.id, path.id);
            return {
              ...row,
              created_at: row.created_at.toISOString(),
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "resendEmailVerification",
        Effect.fnUntraced(
          function* ({ request, path }: AuthenticatedRawRequest<"resendEmailVerification">) {
            const auth = yield* requireAuth(request);
            yield* AuthenticatedRouteService.resendEmailVerification(auth.session.id, path.id);
            return { success: true as const };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "testimonials",
        Effect.fnUntraced(
          function* ({ request }) {
            const auth = yield* requireAuth(request);
            yield* assertCanManageTestimonial(auth);
            const row = yield* AuthenticatedRouteService.testimonial(auth.session.id, auth.user.id);
            return row ? serializeTestimonial(row) : new Response("", { status: 200 });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "upsertTestimonial",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            const auth = yield* requireAuth(request);
            yield* assertCanManageTestimonial(auth);
            const testimonial = yield* AuthenticatedRouteService.upsertTestimonial(
              auth.session.id,
              auth.user.id,
              yield* normalizeTestimonialBody(payload.body),
            );
            return serializeTestimonial(testimonial);
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "deleteTestimonial",
        Effect.fnUntraced(
          function* ({ request }) {
            const auth = yield* requireAuth(request);
            yield* assertCanManageTestimonial(auth);
            yield* AuthenticatedRouteService.deleteTestimonial(auth.session.id, auth.user.id);
            return { success: true as const };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "availableSlots",
        Effect.fnUntraced(
          function* ({ request }) {
            yield* requireAuth(request);
            const query = new URL((request.source as Request).url).searchParams;
            const date = query.get("date");
            if (!date) {
              return yield* new HttpError(400, "Missing date");
            }
            const days = Number.parseInt(query.get("days") ?? "", 10);
            const duration = Number.parseInt(query.get("duration") ?? "", 10);
            return yield* GoogleCalendarService.getAvailableSlots({
              date,
              days: Number.isFinite(days) ? days : 7,
              duration: Number.isFinite(duration) ? duration : 60,
            });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "bookLesson",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            const auth = yield* requireAuth(request);
            const lesson = yield* AuthenticatedRouteService.bookLesson({
              userId: auth.user.id,
              userName: auth.user.name,
              scheduledAt: new Date(payload.scheduled_at),
              durationMinutes: payload.duration_minutes,
              locationType: payload.location_type,
            });
            return serializeLesson(lesson);
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "events",
        Effect.fnUntraced(
          function* ({ request }) {
            const auth = yield* requireAuth(request);
            const userId = auth.user.id;
            const encoder = new TextEncoder();

            const eventStream: Stream.Stream<RealtimeMessage> = Stream.asyncPush(
              (emit) =>
                Effect.acquireRelease(
                  Effect.sync(() => {
                    realtimeBus.on("message", emit.single);
                  }),
                  () =>
                    Effect.sync(() => {
                      realtimeBus.off("message", emit.single);
                    }),
                ),
            );

            const heartbeat = Stream.repeatValue(encoder.encode(":heartbeat\n\n"));

            const sseStream = eventStream.pipe(
              Stream.filter((msg) => msg.userId === userId),
              Stream.map((msg) =>
                encoder.encode(
                  `data: ${JSON.stringify({ event: msg.event, subject: msg.subject, queryKeys: msg.queryKeys })}\n\n`,
                ),
              ),
              Stream.merge(heartbeat),
            );

            return HttpServerResponse.fromWeb(
              new Response(Stream.toReadableStream(sseStream), {
                headers: {
                  "Content-Type": "text/event-stream",
                  "Cache-Control": "no-cache",
                  Connection: "keep-alive",
                },
              }),
            );
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      ),
  );
}
