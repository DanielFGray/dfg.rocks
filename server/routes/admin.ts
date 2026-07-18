import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Effect } from "effect";
import {
  ForbiddenErrorSchema,
  InternalServerErrorSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
} from "../../shared/httpApiErrors.js";
import { adminClientGroup, GcalCallbackQuery } from "../../shared/httpApi.js";
import { env } from "../assertEnv.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { HttpError } from "../pgErrors.js";
import { AdminRouteService } from "../services/adminRouteService.js";
import {
  RecurringScheduleService,
  serializeMonthlyPayment,
  serializeRecurringSchedule,
} from "../services/recurringScheduleService.js";
import { FileService } from "../services/fileService.js";
import { GoogleCalendarService } from "../services/googleCalendarService.js";
import { SessionService } from "../services/sessionService.js";
import { TestimonialReminderService } from "../services/testimonialReminderService.js";
import {
  type LocationType,
  type Material as MaterialResponse,
  type Module as ModuleResponse,
} from "../../shared/schemas.js";
import { serializeLesson, serializeLessonNote } from "../../shared/responseMappers.js";
import { decodeWorkingHoursValue, defaultWorkingHours } from "../../shared/workingHours.js";
import { params, csrfCheck, type RawRequest } from "./raw.js";

const adminErrorStatuses = [400, 401, 403, 404, 409, 413, 500, 502, 503] as const;
const materialDownloadErrorStatuses = [401, 403, 404, 500] as const;

const adaptAdminErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, adminErrorStatuses);

const adaptMaterialDownloadErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, materialDownloadErrorStatuses);

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
    yield* csrfCheck(request.headers);
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

export const adminGroup = adminClientGroup
  .add(HttpApiEndpoint.get("gcalConnect", "/api/admin/gcal/connect"))
  .add(
    HttpApiEndpoint.get("gcalCallback", "/api/admin/gcal/callback").setUrlParams(GcalCallbackQuery),
  );

export const materialDownloadGroup = HttpApiGroup.make("materialDownload")
  .addError(UnauthorizedErrorSchema)
  .addError(ForbiddenErrorSchema)
  .addError(NotFoundErrorSchema)
  .addError(InternalServerErrorSchema)
  .add(HttpApiEndpoint.get("materialDownload", "/materials/:id/download").setPath(params("id")))
  .prefix("/api");

const adminApi = HttpApi.make("dfg").add(adminGroup);

const materialDownloadApi = HttpApi.make("dfg").add(materialDownloadGroup);

export function makeAdminLayer() {
  return HttpApiBuilder.group(adminApi, "admin", (handlers) =>
    handlers
      .handle(
        "gcalConnect",
        Effect.fnUntraced(function* (context) {
          yield* requireAdminSession(context.request, { csrf: false });
          const rootUrl = new URL((context.request.source as Request).url).origin;
          const authorization = yield* GoogleCalendarService.createAuthorizationRequest(rootUrl);
          let response = HttpServerResponse.redirect(authorization.url.toString());
          response = yield* HttpServerResponse.setCookie(
            response,
            GoogleCalendarService.getAuthCookieName(),
            GoogleCalendarService.encodeAuthState(authorization.state),
            GoogleCalendarService.getAuthCookieOptions(rootUrl),
          );
          return response;
        }, adaptAdminErrors),
      )
      .handle(
        "gcalCallback",
        Effect.fnUntraced(function* ({ request, urlParams }) {
          yield* requireAdminSession(request, { csrf: false });
          const rootUrl = new URL((request.source as Request).url).origin;
          const authCookieName = GoogleCalendarService.getAuthCookieName();
          const cookieOptions = GoogleCalendarService.getAuthCookieOptions(rootUrl);
          const authState = yield* GoogleCalendarService.decodeAuthState(
            request.cookies[authCookieName],
          );
          // OAuth failures are raw responses so the one-time state cookie is expired on failure.
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
          yield* GoogleCalendarService.handleCallback(
            rootUrl,
            urlParams.code,
            authState.codeVerifier,
          );
          let response = HttpServerResponse.redirect(
            GoogleCalendarService.getConnectRedirectUrl(rootUrl, authState.redirect),
          );
          response = HttpServerResponse.expireCookie(response, authCookieName, cookieOptions);
          return response;
        }, adaptAdminErrors),
      )
      .handle(
        "submissions",
        Effect.fnUntraced(function* ({ request, urlParams }) {
          const auth = yield* requireAdminSession(request);
          const rows = yield* AdminRouteService.listSubmissions(
            auth.session.id,
            urlParams.limit ?? 50,
            urlParams.offset ?? 0,
          );
          return rows.map((row) => ({
            ...row,
            created_at: row.created_at.toISOString(),
          }));
        }, adaptAdminErrors),
      )
      .handle(
        "updateSubmission",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
          const row = yield* AdminRouteService.updateSubmissionRead(
            auth.session.id,
            path.id,
            payload.is_read,
          );
          if (!row) {
            return yield* new HttpError(404, "Submission not found");
          }
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "students",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireAuthenticatedSession(request);
          if (auth.user.role !== "admin" && auth.user.role !== "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const rows = yield* AdminRouteService.listStudents(auth.session.id);
          return rows.map((row) => ({
            ...row,
            name: row.name ?? "",
            email: row.email ?? "",
            role: row.role,
          }));
        }, adaptAdminErrors),
      )
      .handle(
        "student",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAuthenticatedSession(context.request);
          if (auth.user.role !== "admin" && auth.user.role !== "teacher") {
            return yield* new HttpError(403, "Forbidden");
          }
          const { path } = context;
          const raw = yield* AdminRouteService.getStudent(auth.session.id, path.id);
          return {
            ...raw,
            name: raw.name ?? "",
            email: raw.email ?? "",
            role: raw.role,
          };
        }, adaptAdminErrors),
      )
      .handle(
        "courses",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          return yield* AdminRouteService.listCourses(auth.session.id);
        }, adaptAdminErrors),
      )
      .handle(
        "courseStudents",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { path } = context;
          const rows = yield* AdminRouteService.listCourseStudents(auth.session.id, path.id);
          return rows.map((row) => ({
            id: row.id,
            username: row.username,
            name: row.name ?? "",
            email: row.email ?? "",
            role: row.role,
            is_verified: row.is_verified,
          }));
        }, adaptAdminErrors),
      )
      .handle(
        "createCourse",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          return yield* AdminRouteService.createCourse(auth.session.id, {
            title: payload.title,
            description: payload.description ?? "",
            instrument: payload.instrument,
          });
        }, adaptAdminErrors),
      )
      .handle(
        "updateCourse",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
          const updates: Record<string, string> = {};
          const title = payload.title;
          const description = payload.description;
          const instrument = payload.instrument;
          if (title !== undefined) updates.title = title;
          if (description !== undefined) updates.description = description;
          if (instrument !== undefined) updates.instrument = instrument;
          const course = yield* AdminRouteService.updateCourse(auth.session.id, path.id, updates);
          if (!course) {
            return yield* new HttpError(404, "Course not found");
          }
          return course;
        }, adaptAdminErrors),
      )
      .handle(
        "deleteCourse",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { path } = context;
          yield* AdminRouteService.deleteCourse(auth.session.id, path.id);
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "createModule",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
          return (yield* AdminRouteService.createModule(auth.session.id, path.id, {
            title: payload.title,
            sort_order: payload.sort_order ?? 0,
          })) as unknown as ModuleResponse;
        }, adaptAdminErrors),
      )
      .handle(
        "updateModule",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
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
          const mod = yield* AdminRouteService.updateModule(auth.session.id, path.id, updates);
          if (!mod) {
            return yield* new HttpError(404, "Module not found");
          }
          return mod as unknown as ModuleResponse;
        }, adaptAdminErrors),
      )
      .handle(
        "deleteModule",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { path } = context;
          yield* AdminRouteService.deleteModule(auth.session.id, path.id);
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "enrollStudent",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
          yield* AdminRouteService.enrollStudent(auth.session.id, path.id, payload.course_id);
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "unenrollStudent",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { path } = context;
          yield* AdminRouteService.unenrollStudent(auth.session.id, path.id, path.courseId);
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "assignMaterial",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
          yield* AdminRouteService.assignMaterial({
            sessionId: auth.session.id,
            studentId: path.id,
            materialId: payload.material_id,
            assignedTrackIndex: payload.assigned_track_index,
          });
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "unassignMaterial",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { path } = context;
          yield* AdminRouteService.unassignMaterial(auth.session.id, path.id, path.materialId);
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "deleteMaterial",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { path } = context;
          const row = yield* AdminRouteService.deleteMaterial(auth.session.id, path.id);
          if (!row) {
            return yield* new HttpError(404, "Material not found");
          }
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "uploadMaterial",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          return (yield* FileService.upload(
            payload.file,
            payload.title,
            payload.is_global,
            auth.user.id,
            auth.session.id,
          )) as MaterialResponse;
        }, adaptAdminErrors),
      )
      .handle(
        "createFamily",
        Effect.fnUntraced(function* ({ request, payload }) {
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
        }, adaptAdminErrors),
      )
      .handle(
        "families",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const rows = yield* AdminRouteService.listFamilies(auth.session.id);
          return rows.map((row) => ({
            ...row,
            created_at: row.created_at.toISOString(),
          }));
        }, adaptAdminErrors),
      )
      .handle(
        "inviteFamily",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
          yield* AdminRouteService.inviteFamily(auth.session.id, path.familyId, {
            username: payload.username,
            email: payload.email,
            invitedRole: payload.invited_role,
          });
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "qrInvite",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
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
            const family = yield* AdminRouteService.createQrInviteFamily(auth.session.id, {
              name,
              slug,
            });
            familyId = family.id;
          }
          const invitation = yield* AdminRouteService.createQrInvite(
            familyId,
            payload.invited_role,
          );
          const rootUrl = env.VITE_ROOT_URL;
          return {
            invitationId: invitation.id,
            code: invitation.code,
            url: `${rootUrl}/accept-invite?id=${invitation.id}&code=${invitation.code}`,
            expiresAt: invitation.expires_at.toISOString(),
          };
        }, adaptAdminErrors),
      )
      .handle(
        "familyInvitations",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { path } = context;
          return (yield* AdminRouteService.listFamilyInvitations(
            auth.session.id,
            path.familyId,
          )).map((invitation) => ({
            ...invitation,
            invited_role:
              invitation.invited_role === "parent"
                ? ("parent" as const)
                : invitation.invited_role === "student"
                  ? ("student" as const)
                  : null,
          }));
        }, adaptAdminErrors),
      )
      .handle(
        "createLesson",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          const lesson = yield* AdminRouteService.createLesson({
            sessionId: auth.session.id,
            studentId: payload.student_id,
            scheduledAt: new Date(payload.scheduled_at),
            durationMinutes: payload.duration_minutes,
            locationType: payload.location_type,
            gcalEventId: null,
          });
          return serializeLesson(lesson);
        }, adaptAdminErrors),
      )
      .handle(
        "updateLesson",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
          const updates: Record<string, unknown> = {};
          const scheduledAt = payload.scheduled_at;
          const durationMinutes = payload.duration_minutes;
          const locationType = payload.location_type;
          if (scheduledAt !== undefined) updates.scheduled_at = new Date(scheduledAt);
          if (durationMinutes !== undefined) updates.duration_minutes = durationMinutes;
          if (locationType !== undefined) updates.location_type = locationType;
          const lesson = yield* AdminRouteService.updateLesson(auth.session.id, path.id, {
            scheduledAt: updates.scheduled_at as Date | undefined,
            durationMinutes: updates.duration_minutes as number | undefined,
            locationType: updates.location_type as LocationType | undefined,
          });
          if (!lesson) {
            return yield* new HttpError(404, "Lesson not found");
          }
          return serializeLesson(lesson);
        }, adaptAdminErrors),
      )
      .handle(
        "deleteLesson",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { path } = context;
          const lesson = yield* AdminRouteService.deleteLesson(auth.session.id, path.id);
          if (!lesson) {
            return yield* new HttpError(404, "Lesson not found");
          }
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "cancelLesson",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
          const lesson = yield* AdminRouteService.cancelLesson(
            auth.session.id,
            path.id,
            payload.reason ?? null,
          );
          return serializeLesson(lesson);
        }, adaptAdminErrors),
      )
      .handle(
        "completeLesson",
        Effect.fnUntraced(function* ({ request, path }) {
          const auth = yield* requireAdminSession(request);
          const lesson = yield* AdminRouteService.completeLesson(auth.session.id, path.id);
          return serializeLesson(lesson);
        }, adaptAdminErrors),
      )
      .handle(
        "lessons",
        Effect.fnUntraced(function* ({ request, urlParams }) {
          const auth = yield* requireAdminSession(request);
          const lessons = yield* AdminRouteService.listLessons(auth.session.id, {
            limit: urlParams.limit ?? 50,
            offset: urlParams.offset ?? 0,
            studentId: urlParams.student_id,
            status: urlParams.status,
            from: urlParams.from ? new Date(urlParams.from) : undefined,
            to: urlParams.to ? new Date(urlParams.to) : undefined,
          });
          return lessons.map(serializeLesson);
        }, adaptAdminErrors),
      )
      .handle(
        "saveStudentRate",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          const rate = yield* AdminRouteService.saveStudentRate({
            sessionId: auth.session.id,
            studentId: payload.student_id,
            rateCents: payload.rate_cents,
            lessonDurationMinutes: payload.lesson_duration_minutes,
            locationType: payload.location_type,
            billingModel: payload.billing_model,
            notes: payload.notes ?? null,
          });
          return {
            ...rate,
            created_at: rate.created_at.toISOString(),
          };
        }, adaptAdminErrors),
      )
      .handle(
        "studentRates",
        Effect.fnUntraced(function* ({ request, path, urlParams }) {
          const auth = yield* requireAdminSession(request);
          return (yield* AdminRouteService.listStudentRates(
            auth.session.id,
            path.studentId,
            urlParams.location_type,
          )).map((row) => ({
            ...row,
            created_at: row.created_at.toISOString(),
          }));
        }, adaptAdminErrors),
      )
      .handle(
        "recurringSchedules",
        Effect.fnUntraced(function* ({ request, path }) {
          const auth = yield* requireAdminSession(request);
          const rows = yield* RecurringScheduleService.listSchedules(
            auth.session.id,
            path.studentId,
          );
          return rows.map(serializeRecurringSchedule);
        }, adaptAdminErrors),
      )
      .handle(
        "saveRecurringSchedule",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
          const row = yield* RecurringScheduleService.saveSchedule({
            sessionId: auth.session.id,
            studentId: path.studentId,
            id: payload.id,
            schedule: {
              studentRateId: payload.student_rate_id,
              dayOfWeek: payload.day_of_week,
              localStartTime: payload.local_start_time,
              timezone: payload.timezone,
              startsOn: payload.starts_on,
              endsOn: payload.ends_on ?? null,
              active: payload.active ?? true,
            },
          });
          return serializeRecurringSchedule(row);
        }, adaptAdminErrors),
      )
      .handle(
        "monthlyPayments",
        Effect.fnUntraced(function* ({ request, path }) {
          const auth = yield* requireAdminSession(request);
          const rows = yield* RecurringScheduleService.listPayments(
            auth.session.id,
            path.studentId,
          );
          return rows.map(serializeMonthlyPayment);
        }, adaptAdminErrors),
      )
      .handle(
        "recordMonthlyPayment",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
          const row = yield* RecurringScheduleService.recordPayment({
            sessionId: auth.session.id,
            studentId: path.studentId,
            billingMonth: payload.billing_month,
            amountCents: payload.amount_cents,
            paidAt: new Date(payload.paid_at),
            notes: payload.notes ?? null,
          });
          return serializeMonthlyPayment(row);
        }, adaptAdminErrors),
      )
      .handle(
        "saveLessonNote",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
          const note = yield* AdminRouteService.saveLessonNote(auth.session.id, path.id, {
            topicsCovered: payload.topics_covered ?? null,
            homework: payload.homework ?? null,
            progressObservations: payload.progress_observations ?? null,
            notes: payload.notes ?? null,
            materialIds: payload.material_ids ? [...payload.material_ids] : null,
            draft: payload.draft ?? true,
          });
          return serializeLessonNote(note);
        }, adaptAdminErrors),
      )
      .handle(
        "lessonNote",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { path } = context;
          const note = yield* AdminRouteService.getLessonNote(auth.session.id, path.id);
          if (!note) {
            return yield* new HttpError(404, "Lesson note not found");
          }
          return serializeLessonNote(note);
        }, adaptAdminErrors),
      )
      .handle(
        "publishLessonNote",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { path } = context;
          const note = yield* AdminRouteService.publishLessonNote(auth.session.id, path.id);
          if (!note) {
            return yield* new HttpError(404, "Lesson note not found");
          }
          return serializeLessonNote(note);
        }, adaptAdminErrors),
      )
      .handle(
        "gcalStatus",
        Effect.fnUntraced(function* (context) {
          yield* requireAdminSession(context.request);
          const status = yield* AdminRouteService.getGoogleCalendarStatus();
          return {
            connected: status.connected,
            calendar_id: typeof status.calendar_id === "string" ? status.calendar_id : null,
          };
        }, adaptAdminErrors),
      )
      .handle(
        "gcalDisconnect",
        Effect.fnUntraced(function* (context) {
          yield* requireAdminSession(context.request);
          yield* AdminRouteService.disconnectGoogleCalendar();
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "workingHours",
        Effect.fnUntraced(function* (context) {
          yield* requireAdminSession(context.request);
          return decodeWorkingHoursValue(
            yield* AdminRouteService.getWorkingHours(),
            defaultWorkingHours,
          );
        }, adaptAdminErrors),
      )
      .handle(
        "cancellationPolicySettings",
        Effect.fnUntraced(function* ({ request }) {
          yield* requireAdminSession(request);
          return yield* AdminRouteService.getCancellationPolicySettings();
        }, adaptAdminErrors),
      )
      .handle(
        "saveCancellationPolicySettings",
        Effect.fnUntraced(function* ({ request, payload }) {
          yield* requireAdminSession(request);
          return yield* AdminRouteService.saveCancellationPolicySettings(payload);
        }, adaptAdminErrors),
      )
      .handle(
        "saveWorkingHours",
        Effect.fnUntraced(function* ({ request, payload }) {
          yield* requireAdminSession(request);
          yield* AdminRouteService.saveWorkingHours(payload);
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "testimonialReminderInterval",
        Effect.fnUntraced(function* (context) {
          yield* requireAdminSession(context.request);
          return {
            interval_days: yield* TestimonialReminderService.getIntervalDays(),
          };
        }, adaptAdminErrors),
      )
      .handle(
        "saveTestimonialReminderInterval",
        Effect.fnUntraced(function* ({ request, payload }) {
          yield* requireAdminSession(request);
          yield* TestimonialReminderService.setIntervalDays(payload.interval_days);
          yield* TestimonialReminderService.rescheduleAll(payload.interval_days);
          return {
            success: true as const,
            interval_days: payload.interval_days,
          };
        }, adaptAdminErrors),
      )
      .handle(
        "updateTestimonialApproval",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          const auth = yield* requireAdminSession(request);
          const testimonial = yield* AdminRouteService.updateTestimonialApproval(
            auth.session.id,
            path.id,
            payload.is_approved,
          );
          if (testimonial.is_approved) {
            yield* TestimonialReminderService.clearReminderState(testimonial.user_id);
          } else if (testimonial.role === "student" || testimonial.role === "parent") {
            yield* TestimonialReminderService.scheduleNextReminder(testimonial.user_id);
          }
          return { success: true as const };
        }, adaptAdminErrors),
      ),
  );
}

export function makeMaterialDownloadLayer() {
  return HttpApiBuilder.group(materialDownloadApi, "materialDownload", (handlers) =>
    handlers.handle(
      "materialDownload",
      Effect.fnUntraced(function* (context) {
        const auth = yield* requireAuthenticatedSession(context.request);
        const { path } = context;
        const fileInfo = yield* FileService.download(path.id, auth.user.id, auth.session.id);
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
      }, adaptMaterialDownloadErrors),
    ),
  );
}
