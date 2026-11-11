import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect, Schedule, Schema as S, Stream } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { serializeLesson, serializeTestimonial } from "../../shared/responseMappers.js";
import { AssignedMaterial, Material } from "../../shared/schemas.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { HttpError } from "../pgErrors.js";
import { AuthenticatedRouteService } from "../services/authenticatedRouteService.js";
import { GoogleCalendarService } from "../services/googleCalendarService.js";
import { RealtimeService } from "../services/realtimeService.js";
import {
  resolveEffectiveStudent,
  SessionService,
  type SessionResult,
} from "../services/sessionService.js";
import { csrfCheck, expireSessionCookie, requireSession } from "./raw.js";

type Auth = NonNullable<SessionResult>;

const authenticatedErrorStatuses = [400, 401, 403, 404, 409, 500, 502, 503] as const;

const adaptAuthenticatedErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, authenticatedErrorStatuses);

const assertCanManageTestimonial = Effect.fnUntraced(function* (auth: Auth) {
  if (auth.user.role === "admin") {
    return yield* new HttpError(403, "Admins cannot manage testimonials");
  }
});

const assertCanManageAssignments = Effect.fnUntraced(function* (auth: Auth) {
  if (auth.user.role !== "admin" && auth.user.role !== "teacher") {
    return yield* new HttpError(403, "Forbidden");
  }
});

const assertCanTrackOwnAssignments = Effect.fnUntraced(function* (auth: Auth) {
  if (auth.user.role !== "student" && auth.user.role !== "parent") {
    return yield* new HttpError(403, "Forbidden");
  }
});

export function makeAuthenticatedLayer() {
  return HttpApiBuilder.group(Contract, "authenticated", (handlers) =>
    handlers
      .handle(
        "courses",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireSession(request);
          const effective = resolveEffectiveStudent(auth);
          const filterStudentId = effective.isActing ? effective.studentId : undefined;
          return yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.courses(auth.session.id, filterStudentId),
          );
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "courseById",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireSession(request);
          return yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.courseById(auth.session.id, params.id),
          );
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "library",
        Effect.fnUntraced(function* ({ request, query }) {
          const auth = yield* requireSession(request);
          const rows = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.library(auth.session.id, {
              limit: query.limit ?? 50,
              offset: query.offset ?? 0,
            }),
          );
          return yield* S.decodeUnknownEffect(S.Array(Material))(rows);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "assignments",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireSession(request);
          const effective = resolveEffectiveStudent(auth);
          const filterStudentId = effective.isActing ? effective.studentId : undefined;
          const rows = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.assignments(auth.session.id, filterStudentId),
          );
          return yield* S.decodeUnknownEffect(S.Array(AssignedMaterial))(rows);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "assignStudentMaterial",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireSession(request);
          yield* assertCanManageAssignments(auth);
          yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.assignStudentMaterial({
              sessionId: auth.session.id,
              studentId: params.studentId,
              materialId: payload.material_id,
              assignedTrackIndex: payload.assigned_track_index,
            }),
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "unassignStudentMaterial",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireSession(request);
          yield* assertCanManageAssignments(auth);
          yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.unassignStudentMaterial(
              auth.session.id,
              params.studentId,
              params.materialId,
            ),
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "practiceLogs",
        Effect.fnUntraced(function* ({ request, query }) {
          const auth = yield* requireSession(request);
          const effective = resolveEffectiveStudent(auth);
          const filterStudentId = effective.isActing ? effective.studentId : undefined;
          const rows = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.practiceLogs(
              auth.session.id,
              query.material_id,
              filterStudentId,
            ),
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
          const auth = yield* requireSession(request);
          const effective = resolveEffectiveStudent(auth);
          const row = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.createPracticeLog({
              sessionId: auth.session.id,
              studentId: effective.studentId,
              materialId: payload.material_id,
              rating: payload.rating,
              durationMinutes: payload.duration_minutes,
            }),
          );
          return {
            ...row,
            logged_at: row.logged_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "ratePracticeLog",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireSession(request);
          const effective = resolveEffectiveStudent(auth);
          const row = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.ratePracticeLog(
              auth.session.id,
              effective.studentId,
              payload.material_id,
              payload.rating,
            ),
          );
          return {
            ...row,
            logged_at: row.logged_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "recordAssignmentPlayback",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireSession(request);
          yield* assertCanTrackOwnAssignments(auth);
          const effective = resolveEffectiveStudent(auth);
          const row = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.recordAssignmentPlayback({
              sessionId: auth.session.id,
              studentId: effective.studentId,
              materialId: params.materialId,
              seconds: payload.seconds,
            }),
          );
          return {
            ...row,
            updated_at: row.updated_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "createAssignmentReview",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireSession(request);
          yield* assertCanTrackOwnAssignments(auth);
          const effective = resolveEffectiveStudent(auth);
          const row = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.createAssignmentReview({
              sessionId: auth.session.id,
              studentId: effective.studentId,
              materialId: params.materialId,
              stars: payload.stars,
            }),
          );
          return {
            ...row,
            created_at: row.created_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "assignmentNotes",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireSession(request);
          const row = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.assignmentNotes(auth.session.id, params.materialId),
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
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireSession(request);
          const effective = resolveEffectiveStudent(auth);
          const row = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.upsertAssignmentNotes({
              sessionId: auth.session.id,
              studentId: effective.studentId,
              materialId: params.materialId,
              body: payload.body,
            }),
          );
          return {
            ...row,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "messages",
        Effect.fnUntraced(function* ({ request, query }) {
          const auth = yield* requireSession(request);
          const effective = resolveEffectiveStudent(auth);
          const filterStudentId = effective.isActing ? effective.studentId : undefined;
          const rows = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.messages(
              auth.session.id,
              {
                limit: query.limit ?? 50,
                offset: query.offset ?? 0,
                withUser: query.with,
              },
              filterStudentId,
            ),
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
          const auth = yield* requireSession(request);
          const effective = resolveEffectiveStudent(auth);
          const row = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.createMessage({
              sessionId: auth.session.id,
              senderId: effective.studentId,
              recipientId: payload.recipient_id,
              body: payload.body,
            }),
          );
          return {
            ...row,
            created_at: row.created_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "markMessageRead",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireSession(request);
          yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.markMessageRead(auth.session.id, params.id),
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "myLessons",
        Effect.fnUntraced(function* ({ request, query }) {
          const auth = yield* requireSession(request);
          const effective = resolveEffectiveStudent(auth);
          const filterStudentId = effective.isActing ? effective.studentId : undefined;
          const rows = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.myLessons(
              auth.session.id,
              {
                limit: query.limit ?? 50,
                offset: query.offset ?? 0,
                status: query.status,
                from: query.from,
                to: query.to,
              },
              filterStudentId,
            ),
          );
          return rows.map((row) => serializeLesson(row));
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "myLessonCancellationPolicy",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireSession(request);
          const effective = resolveEffectiveStudent(auth);
          return yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.myLessonCancellationPolicy({
              sessionId: auth.session.id,
              studentId: effective.studentId,
              lessonId: params.id,
            }),
          );
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "cancelMyLesson",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireSession(request);
          yield* csrfCheck(request.headers);
          const effective = resolveEffectiveStudent(auth);
          const lesson = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.cancelMyLesson({
              sessionId: auth.session.id,
              studentId: effective.studentId,
              lessonId: params.id,
              reason: payload.reason ?? null,
            }),
          );
          return serializeLesson(lesson);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "rescheduleMyLesson",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireSession(request);
          yield* csrfCheck(request.headers);
          const effective = resolveEffectiveStudent(auth);
          const lesson = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.rescheduleMyLesson({
              sessionId: auth.session.id,
              studentId: effective.studentId,
              lessonId: params.id,
              scheduledAt: new Date(payload.scheduled_at),
            }),
          );
          return serializeLesson(lesson);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "requestDeleteAccount",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireSession(request);
          yield* csrfCheck(request.headers);
          yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.requestDeleteAccount(auth.session.id),
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "confirmDeleteAccount",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireSession(request);
          yield* csrfCheck(request.headers);
          const deleted = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.confirmDeleteAccount(auth.session.id, payload.token),
          );
          if (!deleted) {
            return yield* new HttpError(400, "Invalid or expired deletion token");
          }
          yield* SessionService.use((sessionService) =>
            sessionService.deleteAllUserSessions(auth.user.id),
          );
          return yield* expireSessionCookie(
            HttpServerResponse.jsonUnsafe({ success: true as const }),
          );
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "myLessonNotesList",
        Effect.fnUntraced(function* ({ request, query }) {
          const auth = yield* requireSession(request);
          const effective = resolveEffectiveStudent(auth);
          const filterStudentId = effective.isActing ? effective.studentId : undefined;
          const rows = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.myLessonNotesList(
              auth.session.id,
              {
                limit: query.limit ?? 50,
                offset: query.offset ?? 0,
              },
              filterStudentId,
            ),
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
          const auth = yield* requireSession(request);
          const rows = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.myEmails(auth.session.id),
          );
          return rows.map((row) => ({
            ...row,
            created_at: row.created_at.toISOString(),
          }));
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "addMyEmail",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireSession(request);
          const row = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.addMyEmail(auth.session.id, payload.email),
          );
          return {
            ...row,
            created_at: row.created_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "deleteMyEmail",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireSession(request);
          yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.deleteMyEmail(auth.session.id, params.id),
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "makePrimaryEmail",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireSession(request);
          const row = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.makePrimaryEmail(auth.session.id, params.id),
          );
          return {
            ...row,
            created_at: row.created_at.toISOString(),
          };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "resendEmailVerification",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireSession(request);
          yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.resendEmailVerification(auth.session.id, params.id),
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "upsertTestimonial",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireSession(request);
          yield* assertCanManageTestimonial(auth);
          const testimonial = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.upsertTestimonial(
              auth.session.id,
              auth.user.id,
              payload.body,
            ),
          );
          return serializeTestimonial(testimonial);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "deleteTestimonial",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireSession(request);
          yield* assertCanManageTestimonial(auth);
          yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.deleteTestimonial(auth.session.id, auth.user.id),
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "availableSlots",
        Effect.fnUntraced(function* ({ request, query }) {
          yield* requireSession(request);
          if (!query.date) {
            return yield* new HttpError(400, "Missing date");
          }
          return yield* GoogleCalendarService.use((googleCalendarService) =>
            googleCalendarService.getAvailableSlots({
              date: query.date,
              days: query.days ?? 7,
              duration: query.duration ?? 60,
            }),
          );
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "bookLesson",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireSession(request);
          const effective = resolveEffectiveStudent(auth);
          const studentId = payload.student_id ?? effective.studentId;
          const lesson = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.bookLesson({
              sessionId: auth.session.id,
              userId: studentId,
              scheduledAt: new Date(payload.scheduled_at),
              durationMinutes: payload.duration_minutes,
              locationType: payload.location_type,
            }),
          );
          return serializeLesson(lesson);
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "switchActiveStudent",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireSession(request);
          if (auth.user.role !== "parent") {
            return yield* new HttpError(403, "Only parents can switch active student");
          }
          yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.switchActiveStudent(
              auth.session.id,
              auth.user.id,
              payload.student_id,
            ),
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "createChild",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireSession(request);
          if (auth.user.role !== "parent") {
            return yield* new HttpError(403, "Only parents can create child accounts");
          }
          return yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.createChild(auth.session.id, auth.user.id, payload.name),
          );
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "family",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireSession(request);
          return yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.family(auth.session.id, auth.user.id),
          );
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "removeFamilyMember",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireSession(request);
          yield* csrfCheck(request.headers);
          yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.removeFamilyMember(
              auth.session.id,
              auth.user.id,
              payload.user_id,
            ),
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "inviteFamilyMember",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireSession(request);
          yield* csrfCheck(request.headers);
          yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.inviteFamilyMember(
              auth.session.id,
              auth.user.id,
              payload.email,
            ),
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "events",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireSession(request);
          const effective = resolveEffectiveStudent(auth);
          const userId = auth.user.id;
          const listenerIds = effective.isActing ? [userId, effective.studentId] : [userId];
          const encoder = new TextEncoder();

          const { messages: eventStream } = yield* RealtimeService;

          const heartbeat = Stream.fromEffectRepeat(
            Effect.succeed(encoder.encode(":heartbeat\n\n")),
          ).pipe(Stream.schedule(Schedule.spaced("15 seconds")));

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
            new Response(sseStream.pipe(Stream.toReadableStream()), {
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
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireSession(request);
          yield* csrfCheck(request.headers);
          if (auth.user.role !== "parent") {
            return yield* new HttpError(403, "Only parents can manage child accounts");
          }
          yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.setChildEmail(
              auth.session.id,
              auth.user.id,
              params.childId,
              payload.email,
            ),
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "requestChildPasswordSet",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireSession(request);
          yield* csrfCheck(request.headers);
          if (auth.user.role !== "parent") {
            return yield* new HttpError(403, "Only parents can manage child accounts");
          }
          return yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.requestChildPasswordSet(
              auth.session.id,
              auth.user.id,
              params.childId,
            ),
          );
        }, adaptAuthenticatedErrors),
      )
      .handle(
        "setChildPassword",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireSession(request);
          yield* csrfCheck(request.headers);
          yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.setChildPassword(
              auth.session.id,
              params.childId,
              payload.token,
              payload.password,
            ),
          );
          return { success: true as const };
        }, adaptAuthenticatedErrors),
      ),
  );
}
