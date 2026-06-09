import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Effect } from "effect";
import {
  adminClientGroup,
  CreateFamilyPayload,
  GcalCallbackQuery,
  SaveStudentRatePayload,
  StudentRatesQuery,
} from "../../shared/httpApi.js";
import { env } from "../assertEnv.js";
import { HttpError } from "../pgErrors.js";
import { AdminRouteService } from "../services/adminRouteService.js";
import { FileService } from "../services/fileService.js";
import { GoogleCalendarService } from "../services/googleCalendarService.js";
import { SessionService } from "../services/sessionService.js";
import { TestimonialReminderService } from "../services/testimonialReminderService.js";
import type { LessonStatus, LocationType } from "../../shared/schemas.js";
import {
  params,
  csrfCheck,
  type RawRequest,
  normalizeToResponse,
  responseForCause,
} from "./raw.js";

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoStringOrNull(value: Date | string | null): string | null {
  return value ? toIsoString(value) : null;
}

const defaultWorkingHours = {
  0: null,
  1: { start: "09:00", end: "20:00" },
  2: { start: "09:00", end: "20:00" },
  3: { start: "09:00", end: "20:00" },
  4: { start: "09:00", end: "20:00" },
  5: { start: "09:00", end: "20:00" },
  6: { start: "10:00", end: "14:00" },
} as const;

const requireAdminSession = Effect.fnUntraced(function* (
  request: RawRequest,
  options: {
    csrf?: boolean;
  } = {},
) {
  const result = yield* SessionService.validateSessionToken(request.cookies.session);
  if (!result) {
    return yield* new HttpError(401, "Unauthorized");
  }
  if (result.user.role !== "admin") {
    return yield* new HttpError(403, "Forbidden");
  }
  if (options.csrf !== false) {
    csrfCheck(request.headers);
  }
  return result;
});

const requireAuthenticatedSession = Effect.fnUntraced(function* (request: RawRequest) {
  const result = yield* SessionService.validateSessionToken(request.cookies.session);
  if (!result) {
    return yield* new HttpError(401, "Not authenticated");
  }
  return result;
});

function serializeLesson(r: {
  scheduled_at: Date | string;
  cancelled_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  [key: string]: unknown;
}) {
  return {
    ...r,
    scheduled_at: toIsoString(r.scheduled_at),
    cancelled_at: toIsoStringOrNull(r.cancelled_at),
    completed_at: toIsoStringOrNull(r.completed_at),
    created_at: toIsoString(r.created_at),
  };
}

function serializeLessonNote(r: {
  material_ids: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  [key: string]: unknown;
}) {
  return {
    ...r,
    material_ids: r.material_ids ?? null,
    created_at: toIsoString(r.created_at),
    updated_at: toIsoString(r.updated_at),
  };
}

export const adminGroup = adminClientGroup
  .add(HttpApiEndpoint.get("gcalConnect", "/api/admin/gcal/connect"))
  .add(HttpApiEndpoint.get("gcalCallback", "/api/admin/gcal/callback").setUrlParams(GcalCallbackQuery))
  .add(HttpApiEndpoint.get("module", "/api/admin/modules/:id").setPath(params("id")))
  .add(HttpApiEndpoint.post("createFamily", "/api/admin/families").setPayload(CreateFamilyPayload))
  .add(
    HttpApiEndpoint.get("familyInvitations", "/api/admin/families/:familyId/invitations").setPath(
      params("familyId"),
    ),
  )
  .add(HttpApiEndpoint.del("deleteLesson", "/api/admin/lessons/:id").setPath(params("id")))
  .add(HttpApiEndpoint.post("saveStudentRate", "/api/admin/student-rates").setPayload(SaveStudentRatePayload))
  .add(
    HttpApiEndpoint.get("studentRates", "/api/admin/student-rates/:studentId").setPath(
      params("studentId"),
    ).setUrlParams(StudentRatesQuery),
  )
  .add(
    HttpApiEndpoint.get("testimonialReminderInterval", "/api/admin/testimonial-reminder-interval"),
  );

export const materialDownloadGroup = HttpApiGroup.make("materialDownload")
  .add(HttpApiEndpoint.get("materialDownload", "/materials/:id/download").setPath(params("id")))
  .prefix("/api");

const adminApi = HttpApi.make("dfg").add(adminGroup);

const materialDownloadApi = HttpApi.make("dfg").add(materialDownloadGroup);

export function makeAdminLayer() {
  return HttpApiBuilder.group(adminApi, "admin", (handlers) =>
    handlers
      .handle(
        "gcalConnect",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request, { csrf: false });
            const rootUrl = new URL((context.request.source as Request).url).origin;
            const authorization = yield* GoogleCalendarService.createAuthorizationRequest(rootUrl);
            let response = HttpServerResponse.redirect(authorization.url.toString());
            response = Effect.runSync(
              HttpServerResponse.setCookie(
                response,
                GoogleCalendarService.getAuthCookieName(),
                GoogleCalendarService.encodeAuthState(authorization.state),
                GoogleCalendarService.getAuthCookieOptions(rootUrl),
              ),
            );
            return response;
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "gcalCallback",
        Effect.fnUntraced(
          function* ({ request, urlParams }) {
            yield* requireAdminSession(request, { csrf: false });
            const rootUrl = new URL((request.source as Request).url).origin;
            const authCookieName = GoogleCalendarService.getAuthCookieName();
            const cookieOptions = GoogleCalendarService.getAuthCookieOptions(rootUrl);
            const authState = yield* GoogleCalendarService.decodeAuthState(
              request.cookies[authCookieName],
            );
            const fail = (status: number, message: string) =>
              HttpServerResponse.expireCookie(
                HttpServerResponse.unsafeJson({ error: message }, { status }),
                authCookieName,
                cookieOptions,
              );
            if (urlParams.error) {
              return fail(400, `Google Calendar OAuth failed (${urlParams.error})`);
            }
            if (!urlParams.code || !urlParams.state) {
              return fail(400, "Missing Google Calendar OAuth callback parameters");
            }
            if (!authState || authState.state !== urlParams.state) {
              return fail(400, "Invalid or expired Google Calendar OAuth state");
            }
            yield* GoogleCalendarService.handleCallback(rootUrl, urlParams.code, authState.codeVerifier);
            let response = HttpServerResponse.redirect(
              GoogleCalendarService.getConnectRedirectUrl(rootUrl, authState.redirect),
            );
            response = HttpServerResponse.expireCookie(response, authCookieName, cookieOptions);
            return response;
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "submissions",
        Effect.fnUntraced(
          function* ({ request, urlParams }) {
            yield* requireAdminSession(request);
            const rows = yield* AdminRouteService.listSubmissions(
              urlParams.limit ?? 50,
              urlParams.offset ?? 0,
            );
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
        "updateSubmission",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            yield* requireAdminSession(request);
            const row = yield* AdminRouteService.updateSubmissionRead(path.id, payload.is_read);
            if (!row) {
              return yield* new HttpError(404, "Submission not found");
            }
            return HttpServerResponse.unsafeJson({ success: true as const });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "students",
        Effect.fnUntraced(
          function* ({ request }) {
            yield* requireAdminSession(request);
            const rows = yield* AdminRouteService.listStudents();
            return rows.map((row) => ({
              ...row,
              name: row.name ?? "",
              email: row.email ?? "",
              role: row.role,
            }));
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "student",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            const { path } = context;
            const raw = yield* AdminRouteService.getStudent(path.id);
            return {
              ...raw,
              name: raw.name ?? "",
              email: raw.email ?? "",
              role: raw.role,
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "courses",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            return yield* AdminRouteService.listCourses();
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "courseStudents",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            const { path } = context;
            const rows = yield* AdminRouteService.listCourseStudents(path.id);
            return rows.map((row) => ({
              id: row.id,
              username: row.username,
              name: row.name ?? "",
              email: row.email ?? "",
              role: row.role,
              is_verified: row.is_verified,
            }));
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "createCourse",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            yield* requireAdminSession(request);
            return yield* AdminRouteService.createCourse({
              title: payload.title,
              description: payload.description ?? "",
              instrument: payload.instrument,
            });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "updateCourse",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            yield* requireAdminSession(request);
            const updates: Record<string, string> = {};
            const title = payload.title;
            const description = payload.description;
            const instrument = payload.instrument;
            if (title !== undefined) updates.title = title;
            if (description !== undefined) updates.description = description;
            if (instrument !== undefined) updates.instrument = instrument;
            const course = yield* AdminRouteService.updateCourse(path.id, updates);
            if (!course) {
              return yield* new HttpError(404, "Course not found");
            }
            return course;
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "deleteCourse",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            const { path } = context;
            yield* AdminRouteService.deleteCourse(path.id);
            return HttpServerResponse.unsafeJson({ success: true as const });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "module",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            const { path } = context;
            const mod = yield* AdminRouteService.getModule(path.id);
            if (!mod) {
              return yield* new HttpError(404, "Module not found");
            }
            return mod;
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "createModule",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            yield* requireAdminSession(request);
            return yield* AdminRouteService.createModule(path.id, {
              title: payload.title,
              sort_order: payload.sort_order ?? 0,
            });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "updateModule",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            yield* requireAdminSession(request);
            const updates: Record<string, unknown> = {};
            const title = payload.title;
            const sortOrder = payload.sort_order;
            if (title !== undefined) {
              updates.title = title;
            }
            if (payload.content !== undefined) {
              updates.content = payload.content;
            }
            if (sortOrder !== undefined) {
              updates.sort_order = sortOrder;
            }
            const mod = yield* AdminRouteService.updateModule(path.id, updates);
            if (!mod) {
              return yield* new HttpError(404, "Module not found");
            }
            return mod;
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "deleteModule",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            const { path } = context;
            yield* AdminRouteService.deleteModule(path.id);
            return HttpServerResponse.unsafeJson({ success: true as const });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "enrollStudent",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            yield* requireAdminSession(request);
            yield* AdminRouteService.enrollStudent(path.id, payload.course_id);
            return HttpServerResponse.unsafeJson({ success: true as const });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "unenrollStudent",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            const { path } = context;
            yield* AdminRouteService.unenrollStudent(path.id, path.courseId);
            return HttpServerResponse.unsafeJson({ success: true as const });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "assignMaterial",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            yield* requireAdminSession(request);
            yield* AdminRouteService.assignMaterial({
              studentId: path.id,
              materialId: payload.material_id,
              assignedTrackIndex: payload.assigned_track_index,
            });
            return HttpServerResponse.unsafeJson({ success: true as const });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "unassignMaterial",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            const { path } = context;
            yield* AdminRouteService.unassignMaterial(path.id, path.materialId);
            return HttpServerResponse.unsafeJson({ success: true as const });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "deleteMaterial",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            const { path } = context;
            const row = yield* AdminRouteService.deleteMaterial(path.id);
            if (!row) {
              return yield* new HttpError(404, "Material not found");
            }
            return HttpServerResponse.unsafeJson({ success: true as const });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "uploadMaterial",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            const auth = yield* requireAdminSession(request);
            return yield* FileService.upload(
              payload.file,
              payload.title,
              payload.is_global,
              auth.user.id,
            );
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "createFamily",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            const auth = yield* requireAdminSession(request);
            const familyResult = yield* AdminRouteService.createFamily(auth.session.id, {
              slug: payload.slug,
              name: payload.name,
            });
            const family = Array.isArray(familyResult) ? familyResult[0] : familyResult;
            if (!family) {
              return yield* new HttpError(500, "Failed to create family");
            }
            return {
              ...family,
              created_at: family.created_at.toISOString(),
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "families",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            const rows = yield* AdminRouteService.listFamilies();
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
        "inviteFamily",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            const auth = yield* requireAdminSession(request);
            yield* AdminRouteService.inviteFamily(auth.session.id, path.familyId, {
              username: payload.username,
              email: payload.email,
            });
            return HttpServerResponse.unsafeJson({ success: true as const });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "qrInvite",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            yield* requireAdminSession(request);
            let familyId = path.familyId;
            if (familyId === "new") {
              const name = payload.name;
              const slug = payload.slug;
              if (!name || !slug) {
                return yield* new HttpError(
                  400,
                  "Name and slug are required when creating a new family",
                );
              }
              const family = yield* AdminRouteService.createQrInviteFamily({
                name,
                slug,
              });
              familyId = family.id;
            }
            const invitation = yield* AdminRouteService.createQrInvite(familyId);
            const rootUrl = env.VITE_ROOT_URL;
            return {
              invitationId: invitation.id,
              code: invitation.code,
              url: `${rootUrl}/accept-invite?id=${invitation.id}&code=${invitation.code}`,
              expiresAt: invitation.expires_at.toISOString(),
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "familyInvitations",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            const { path } = context;
            return yield* AdminRouteService.listFamilyInvitations(path.familyId);
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "createLesson",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            yield* requireAdminSession(request);
            const lesson = yield* AdminRouteService.createLesson({
              studentId: payload.student_id,
              scheduledAt: new Date(payload.scheduled_at),
              durationMinutes: payload.duration_minutes,
              locationType: payload.location_type,
              gcalEventId: null,
            });
            return serializeLesson(lesson);
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "updateLesson",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            yield* requireAdminSession(request);
            const updates: Record<string, unknown> = {};
            const scheduledAt = payload.scheduled_at;
            const durationMinutes = payload.duration_minutes;
            const locationType = payload.location_type;
            const status = payload.status;
            const cancellationReason = payload.cancellation_reason;
            if (scheduledAt !== undefined) updates.scheduled_at = new Date(scheduledAt);
            if (durationMinutes !== undefined) updates.duration_minutes = durationMinutes;
            if (locationType !== undefined) updates.location_type = locationType;
            if (status !== undefined) {
              updates.status = status;
            }
            if (cancellationReason !== undefined) updates.cancellation_reason = cancellationReason;
            const lesson = yield* AdminRouteService.updateLesson(path.id, {
              scheduledAt: updates.scheduled_at as Date | undefined,
              durationMinutes: updates.duration_minutes as number | undefined,
              locationType: updates.location_type as LocationType | undefined,
              status: updates.status as LessonStatus | undefined,
              cancellationReason: updates.cancellation_reason as string | undefined,
            });
            if (!lesson) {
              return yield* new HttpError(404, "Lesson not found");
            }
            return serializeLesson(lesson);
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "deleteLesson",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            const { path } = context;
            const lesson = yield* AdminRouteService.deleteLesson(path.id);
            if (!lesson) {
              return yield* new HttpError(404, "Lesson not found");
            }
            return HttpServerResponse.unsafeJson({ success: true as const });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "lessons",
        Effect.fnUntraced(
          function* ({ request, urlParams }) {
            yield* requireAdminSession(request);
            const lessons = yield* AdminRouteService.listLessons({
              limit: urlParams.limit ?? 50,
              offset: urlParams.offset ?? 0,
              studentId: urlParams.student_id,
              status: urlParams.status,
              from: urlParams.from ? new Date(urlParams.from) : undefined,
              to: urlParams.to ? new Date(urlParams.to) : undefined,
            });
            return lessons.map(serializeLesson);
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "saveStudentRate",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            yield* requireAdminSession(request);
            const rate = yield* AdminRouteService.saveStudentRate({
              studentId: payload.student_id,
              rateCents: payload.rate_cents,
              lessonDurationMinutes: payload.lesson_duration_minutes,
              locationType: payload.location_type,
              notes: payload.notes ?? null,
            });
            return {
              ...rate,
              created_at: rate.created_at.toISOString(),
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "studentRates",
        Effect.fnUntraced(
          function* ({ request, path, urlParams }) {
            yield* requireAdminSession(request);
            return (yield* AdminRouteService.listStudentRates(
              path.studentId,
              urlParams.location_type,
            )).map((row) => ({
              ...row,
              created_at: row.created_at.toISOString(),
            }));
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "saveLessonNote",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            yield* requireAdminSession(request);
            const note = yield* AdminRouteService.saveLessonNote(path.id, {
              topicsCovered: payload.topics_covered ?? null,
              homework: payload.homework ?? null,
              progressObservations: payload.progress_observations ?? null,
              notes: payload.notes ?? null,
              materialIds: payload.material_ids ? [...payload.material_ids] : null,
              draft: payload.draft ?? true,
            });
            return serializeLessonNote(note);
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "lessonNote",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            const { path } = context;
            const note = yield* AdminRouteService.getLessonNote(path.id);
            if (!note) {
              return yield* new HttpError(404, "Lesson note not found");
            }
            return serializeLessonNote(note);
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "publishLessonNote",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            const { path } = context;
            const note = yield* AdminRouteService.publishLessonNote(path.id);
            if (!note) {
              return yield* new HttpError(404, "Lesson note not found");
            }
            return serializeLessonNote(note);
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "gcalStatus",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            return yield* AdminRouteService.getGoogleCalendarStatus();
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "gcalDisconnect",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            yield* AdminRouteService.disconnectGoogleCalendar();
            return HttpServerResponse.unsafeJson({ success: true as const });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "workingHours",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            return (yield* AdminRouteService.getWorkingHours()) ?? defaultWorkingHours;
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "saveWorkingHours",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            yield* requireAdminSession(request);
            yield* AdminRouteService.saveWorkingHours(payload);
            return HttpServerResponse.unsafeJson({ success: true as const });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "testimonialReminderInterval",
        Effect.fnUntraced(
          function* (context) {
            yield* requireAdminSession(context.request);
            return {
              interval_days: yield* TestimonialReminderService.getIntervalDays(),
            };
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "saveTestimonialReminderInterval",
        Effect.fnUntraced(
          function* ({ request, payload }) {
            yield* requireAdminSession(request);
            yield* TestimonialReminderService.setIntervalDays(payload.interval_days);
            yield* TestimonialReminderService.rescheduleAll(payload.interval_days);
            return HttpServerResponse.unsafeJson({
              success: true as const,
              interval_days: payload.interval_days,
            });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      )
      .handle(
        "updateTestimonialApproval",
        Effect.fnUntraced(
          function* ({ request, path, payload }) {
            yield* requireAdminSession(request);
            const testimonial = yield* AdminRouteService.updateTestimonialApproval(
              path.id,
              payload.is_approved,
            );
            if (testimonial.is_approved) {
              yield* TestimonialReminderService.clearReminderState(testimonial.user_id);
            } else if (testimonial.role === "student" || testimonial.role === "parent") {
              yield* TestimonialReminderService.scheduleNextReminder(testimonial.user_id);
            }
            return HttpServerResponse.unsafeJson({ success: true as const });
          },
          Effect.catchAllCause(responseForCause),
          Effect.map(normalizeToResponse),
        ),
      ),
  );
}

export function makeMaterialDownloadLayer() {
  return HttpApiBuilder.group(materialDownloadApi, "materialDownload", (handlers) =>
    handlers.handle(
      "materialDownload",
      Effect.fnUntraced(
        function* (context) {
          const auth = yield* requireAuthenticatedSession(context.request);
          const { path } = context;
          const fileInfo = yield* FileService.download(path.id, auth.user.id);
          return HttpServerResponse.fromWeb(
            new Response(fileInfo.stream as unknown as BodyInit, {
              headers: {
                "content-type": fileInfo.mimeType,
                "content-disposition":
                  fileInfo.mimeType === "application/pdf"
                    ? `inline; filename="${encodeURIComponent(fileInfo.filename)}"`
                    : `attachment; filename="${encodeURIComponent(fileInfo.filename)}"`,
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
