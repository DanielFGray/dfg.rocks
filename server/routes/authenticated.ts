import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Effect, Schedule, Schema as S, Stream } from "effect";
import { authenticatedClientGroup } from "../../shared/httpApi.js";
import { serializeLesson, serializeTestimonial } from "../../shared/responseMappers.js";
import { AssignedMaterial, Material } from "../../shared/schemas.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { HttpError } from "../pgErrors.js";
import { realtimeBus, type RealtimeMessage } from "../services/realtimeBus.js";
import { AuthenticatedRouteService } from "../services/authenticatedRouteService.js";
import { GoogleCalendarService } from "../services/googleCalendarService.js";
import {
  resolveEffectiveStudent,
  SessionService,
  type SessionResult,
} from "../services/sessionService.js";
import { csrfCheck, expireSessionCookie, type RawRequest } from "./raw.js";

type Auth = NonNullable<SessionResult>;

const authenticatedErrorStatuses = [400, 401, 403, 404, 409, 500, 502, 503] as const;

const adaptAuthenticatedErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, authenticatedErrorStatuses);

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
  if (auth.user.role !== "student" && auth.user.role !== "parent") {
    return yield* HttpError.make(403, "Forbidden");
  }
});

function requireAuth(request: RawRequest) {
  return Effect.flatMap(SessionService.validateSessionToken(request.cookies.session), (auth) =>
    auth ? Effect.succeed(auth) : HttpError.make(401, "Unauthorized"),
  );
}

const events = HttpApiEndpoint.get("events", "/api/events");

export const authenticatedGroup = authenticatedClientGroup.add(events);

const authenticatedApi = HttpApi.make("dfg").add(authenticatedGroup);
export function makeAuthenticatedLayer() {
  return HttpApiBuilder.group(authenticatedApi, "authenticated", (handlers) =>
    handlers
      .handle(
        "courses",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireAuth(request);
          const effective = resolveEffectiveStudent(auth);
          const filterStudentId = effective.isActing ? effective.studentId : undefined;
          return yield* AuthenticatedRouteService.courses(auth.session.id, filterStudentId);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "courseById",
        Effect.fnUntraced(function* ({ request, path }) {
          const auth = yield* requireAuth(request);
          return yield* AuthenticatedRouteService.courseById(auth.session.id, path.id);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "library",
        Effect.fnUntraced(function* ({ request, urlParams }) {
          const auth = yield* requireAuth(request);
          const rows = yield* AuthenticatedRouteService.library(auth.session.id, {
            limit: urlParams.limit ?? 50,
            offset: urlParams.offset ?? 0,
          });
          return yield* S.decodeUnknown(S.Array(Material))(rows);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "assignments",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireAuth(request);
          const effective = resolveEffectiveStudent(auth);
          const filterStudentId = effective.isActing ? effective.studentId : undefined;
          const rows = yield* AuthenticatedRouteService.assignments(
            auth.session.id,
            filterStudentId,
          );
          return yield* S.decodeUnknown(S.Array(AssignedMaterial))(rows);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "assignStudentMaterial",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAuth(request);
          yield* assertCanManageAssignments(auth);
          yield* AuthenticatedRouteService.assignStudentMaterial({
            sessionId: auth.session.id,
            studentId: path.studentId,
            materialId: payload.material_id,
            assignedTrackIndex: payload.assigned_track_index,
          });
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "unassignStudentMaterial",
        Effect.fnUntraced(function* ({ request, path }) {
          const auth = yield* requireAuth(request);
          yield* assertCanManageAssignments(auth);
          yield* AuthenticatedRouteService.unassignStudentMaterial(
            auth.session.id,
            path.studentId,
            path.materialId,
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "practiceLogs",
        Effect.fnUntraced(function* ({ request, urlParams }) {
          const auth = yield* requireAuth(request);
          const effective = resolveEffectiveStudent(auth);
          const filterStudentId = effective.isActing ? effective.studentId : undefined;
          const rows = yield* AuthenticatedRouteService.practiceLogs(
            auth.session.id,
            urlParams.material_id,
            filterStudentId,
          );
          return rows.map((row) => ({
            ...row,
            logged_at: row.logged_at.toISOString(),
          }));
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "createPracticeLog",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAuth(request);
          const effective = resolveEffectiveStudent(auth);
          const row = yield* AuthenticatedRouteService.createPracticeLog({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            materialId: payload.material_id,
            rating: payload.rating,
            durationMinutes: payload.duration_minutes,
          });
          return {
            ...row,
            logged_at: row.logged_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "ratePracticeLog",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAuth(request);
          const effective = resolveEffectiveStudent(auth);
          const row = yield* AuthenticatedRouteService.ratePracticeLog(
            auth.session.id,
            effective.studentId,
            payload.material_id,
            payload.rating,
          );
          return {
            ...row,
            logged_at: row.logged_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "recordAssignmentPlayback",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAuth(request);
          yield* assertCanTrackOwnAssignments(auth);
          const effective = resolveEffectiveStudent(auth);
          const row = yield* AuthenticatedRouteService.recordAssignmentPlayback({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            materialId: path.materialId,
            seconds: payload.seconds,
          });
          return {
            ...row,
            updated_at: row.updated_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "createAssignmentReview",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAuth(request);
          yield* assertCanTrackOwnAssignments(auth);
          const effective = resolveEffectiveStudent(auth);
          const row = yield* AuthenticatedRouteService.createAssignmentReview({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            materialId: path.materialId,
            stars: payload.stars,
          });
          return {
            ...row,
            created_at: row.created_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "assignmentNotes",
        Effect.fnUntraced(function* ({ request, path }) {
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
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "upsertAssignmentNotes",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAuth(request);
          const effective = resolveEffectiveStudent(auth);
          const row = yield* AuthenticatedRouteService.upsertAssignmentNotes({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            materialId: path.materialId,
            body: payload.body,
          });
          return {
            ...row,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "messages",
        Effect.fnUntraced(function* ({ request, urlParams }) {
          const auth = yield* requireAuth(request);
          const effective = resolveEffectiveStudent(auth);
          const filterStudentId = effective.isActing ? effective.studentId : undefined;
          const rows = yield* AuthenticatedRouteService.messages(
            auth.session.id,
            {
              limit: urlParams.limit ?? 50,
              offset: urlParams.offset ?? 0,
              withUser: urlParams.with,
            },
            filterStudentId,
          );
          return rows.map((row) => ({
            ...row,
            created_at: row.created_at.toISOString(),
          }));
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "createMessage",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAuth(request);
          const effective = resolveEffectiveStudent(auth);
          const row = yield* AuthenticatedRouteService.createMessage({
            sessionId: auth.session.id,
            senderId: effective.studentId,
            recipientId: payload.recipient_id,
            body: payload.body,
          });
          return {
            ...row,
            created_at: row.created_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "markMessageRead",
        Effect.fnUntraced(function* ({ request, path }) {
          const auth = yield* requireAuth(request);
          yield* AuthenticatedRouteService.markMessageRead(auth.session.id, path.id);
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "myLessons",
        Effect.fnUntraced(function* ({ request, urlParams }) {
          const auth = yield* requireAuth(request);
          const effective = resolveEffectiveStudent(auth);
          const filterStudentId = effective.isActing ? effective.studentId : undefined;
          const rows = yield* AuthenticatedRouteService.myLessons(
            auth.session.id,
            {
              limit: urlParams.limit ?? 50,
              offset: urlParams.offset ?? 0,
              status: urlParams.status,
              from: urlParams.from,
              to: urlParams.to,
            },
            filterStudentId,
          );
          return rows.map((row) => serializeLesson(row));
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "myLessonCancellationPolicy",
        Effect.fnUntraced(function* ({ request, path }) {
          const auth = yield* requireAuth(request);
          const effective = resolveEffectiveStudent(auth);
          return yield* AuthenticatedRouteService.myLessonCancellationPolicy({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            lessonId: path.id,
          });
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "cancelMyLesson",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAuth(request);
          yield* csrfCheck(request.headers);
          const effective = resolveEffectiveStudent(auth);
          const lesson = yield* AuthenticatedRouteService.cancelMyLesson({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            lessonId: path.id,
            reason: payload.reason ?? null,
          });
          return serializeLesson(lesson);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "rescheduleMyLesson",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAuth(request);
          yield* csrfCheck(request.headers);
          const effective = resolveEffectiveStudent(auth);
          const lesson = yield* AuthenticatedRouteService.rescheduleMyLesson({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            lessonId: path.id,
            scheduledAt: new Date(payload.scheduled_at),
          });
          return serializeLesson(lesson);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "requestDeleteAccount",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireAuth(request);
          yield* csrfCheck(request.headers);
          yield* AuthenticatedRouteService.requestDeleteAccount(auth.session.id);
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "confirmDeleteAccount",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAuth(request);
          yield* csrfCheck(request.headers);
          const deleted = yield* AuthenticatedRouteService.confirmDeleteAccount(
            auth.session.id,
            payload.token,
          );
          if (!deleted) {
            return yield* new HttpError(400, "Invalid or expired deletion token");
          }
          yield* SessionService.deleteAllUserSessions(auth.user.id);
          return expireSessionCookie(HttpServerResponse.unsafeJson({ success: true as const }));
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "myLessonNotesList",
        Effect.fnUntraced(function* ({ request, urlParams }) {
          const auth = yield* requireAuth(request);
          const effective = resolveEffectiveStudent(auth);
          const filterStudentId = effective.isActing ? effective.studentId : undefined;
          const rows = yield* AuthenticatedRouteService.myLessonNotesList(
            auth.session.id,
            {
              limit: urlParams.limit ?? 50,
              offset: urlParams.offset ?? 0,
            },
            filterStudentId,
          );
          return rows.map((row) => ({
            ...row,
            material_ids: row.material_ids ?? null,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
          }));
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "myEmails",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireAuth(request);
          const rows = yield* AuthenticatedRouteService.myEmails(auth.session.id);
          return rows.map((row) => ({
            ...row,
            created_at: row.created_at.toISOString(),
          }));
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "addMyEmail",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAuth(request);
          const row = yield* AuthenticatedRouteService.addMyEmail(auth.session.id, payload.email);
          return {
            ...row,
            created_at: row.created_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "deleteMyEmail",
        Effect.fnUntraced(function* ({ request, path }) {
          const auth = yield* requireAuth(request);
          yield* AuthenticatedRouteService.deleteMyEmail(auth.session.id, path.id);
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "makePrimaryEmail",
        Effect.fnUntraced(function* ({ request, path }) {
          const auth = yield* requireAuth(request);
          const row = yield* AuthenticatedRouteService.makePrimaryEmail(auth.session.id, path.id);
          return {
            ...row,
            created_at: row.created_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "resendEmailVerification",
        Effect.fnUntraced(function* ({ request, path }) {
          const auth = yield* requireAuth(request);
          yield* AuthenticatedRouteService.resendEmailVerification(auth.session.id, path.id);
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "upsertTestimonial",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAuth(request);
          yield* assertCanManageTestimonial(auth);
          const testimonial = yield* AuthenticatedRouteService.upsertTestimonial(
            auth.session.id,
            auth.user.id,
            payload.body,
          );
          return serializeTestimonial(testimonial);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "deleteTestimonial",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireAuth(request);
          yield* assertCanManageTestimonial(auth);
          yield* AuthenticatedRouteService.deleteTestimonial(auth.session.id, auth.user.id);
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "availableSlots",
        Effect.fnUntraced(function* ({ request, urlParams }) {
          yield* requireAuth(request);
          if (!urlParams.date) {
            return yield* new HttpError(400, "Missing date");
          }
          return yield* GoogleCalendarService.getAvailableSlots({
            date: urlParams.date,
            days: urlParams.days ?? 7,
            duration: urlParams.duration ?? 60,
          });
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "bookLesson",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAuth(request);
          const effective = resolveEffectiveStudent(auth);
          const studentId = payload.student_id ?? effective.studentId;
          const lesson = yield* AuthenticatedRouteService.bookLesson({
            sessionId: auth.session.id,
            userId: studentId,
            scheduledAt: new Date(payload.scheduled_at),
            durationMinutes: payload.duration_minutes,
            locationType: payload.location_type,
          });
          return serializeLesson(lesson);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "switchActiveStudent",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAuth(request);
          if (auth.user.role !== "parent") {
            return yield* HttpError.make(403, "Only parents can switch active student");
          }
          yield* AuthenticatedRouteService.switchActiveStudent(
            auth.session.id,
            auth.user.id,
            payload.student_id,
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "createChild",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAuth(request);
          if (auth.user.role !== "parent") {
            return yield* HttpError.make(403, "Only parents can create child accounts");
          }
          return yield* AuthenticatedRouteService.createChild(
            auth.session.id,
            auth.user.id,
            payload.name,
          );
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "family",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireAuth(request);
          return yield* AuthenticatedRouteService.family(auth.session.id, auth.user.id);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "removeFamilyMember",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAuth(request);
          yield* csrfCheck(request.headers);
          yield* AuthenticatedRouteService.removeFamilyMember(
            auth.session.id,
            auth.user.id,
            payload.user_id,
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "inviteFamilyMember",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAuth(request);
          yield* csrfCheck(request.headers);
          yield* AuthenticatedRouteService.inviteFamilyMember(
            auth.session.id,
            auth.user.id,
            payload.email,
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "events",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireAuth(request);
          const effective = resolveEffectiveStudent(auth);
          const userId = auth.user.id;
          const listenerIds = effective.isActing ? [userId, effective.studentId] : [userId];
          const encoder = new TextEncoder();

          const eventStream: Stream.Stream<RealtimeMessage> = Stream.asyncPush((emit) =>
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

          const heartbeat = Stream.repeatValue(encoder.encode(":heartbeat\n\n")).pipe(
            Stream.schedule(Schedule.spaced("15 seconds")),
          );

          const sseStream = eventStream.pipe(
            Stream.filter((msg) => listenerIds.includes(msg.userId)),
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
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "setChildEmail",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAuth(request);
          yield* csrfCheck(request.headers);
          if (auth.user.role !== "parent") {
            return yield* HttpError.make(403, "Only parents can manage child accounts");
          }
          yield* AuthenticatedRouteService.setChildEmail(
            auth.session.id,
            auth.user.id,
            path.childId,
            payload.email,
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "requestChildPasswordSet",
        Effect.fnUntraced(function* ({ request, path }) {
          const auth = yield* requireAuth(request);
          yield* csrfCheck(request.headers);
          if (auth.user.role !== "parent") {
            return yield* HttpError.make(403, "Only parents can manage child accounts");
          }
          return yield* AuthenticatedRouteService.requestChildPasswordSet(
            auth.session.id,
            auth.user.id,
            path.childId,
          );
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "setChildPassword",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAuth(request);
          yield* csrfCheck(request.headers);
          yield* AuthenticatedRouteService.setChildPassword(
            auth.session.id,
            path.childId,
            payload.token,
            payload.password,
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      ),
  );
}
