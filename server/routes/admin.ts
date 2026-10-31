import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect } from "effect";
import {
  ForbiddenErrorSchema,
  InternalServerErrorSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
} from "../../shared/httpApiErrors.js";
import { adminClientErrors, adminClientGroup, GcalCallbackQuery } from "../../shared/httpApi.js";
import { env } from "../assertEnv.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { HttpError } from "../pgErrors.js";
import { AdminRouteService } from "../services/adminRouteService.js";
import { BillingLedgerService } from "../services/billingLedgerService.js";
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
  type Adjustment as AdjustmentResponse,
  type Bill as BillResponse,
  type BillDetailResponse as BillDetailResponseType,
  type CreditApplication as CreditApplicationResponse,
  type AdminFamilyCredit as FamilyCreditResponse,
  type FamilyDiscount as FamilyDiscountResponse,
  type FamilyTaxExemption as FamilyTaxExemptionResponse,
  type Payment as PaymentResponse,
  type Refund as RefundResponse,
  type TaxRate as TaxRateResponse,
  type LocationType,
  type Material as MaterialResponse,
} from "../../shared/schemas.js";
import { serializeLesson, serializeLessonNote } from "../../shared/responseMappers.js";
import { params, csrfCheck, type RawRequest } from "./raw.js";
import type { Selectable } from "kysely";
import type {
  AppPublicBills,
  AppPublicPayments,
  AppPublicFamilyCredits,
  AppPublicBillLineItems,
  AppPublicBillAdjustments,
  AppPublicFamilyCreditApplications,
  AppPublicFamilyDiscounts,
  AppPublicTaxRates,
  AppPublicFamilyTaxExemptions,
  AppPublicRefunds,
} from "../../generated/db.js";

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
  const result = yield* SessionService.use((sessionService) =>
    sessionService.validateSessionToken(request.cookies.session),
  );
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
  const result = yield* SessionService.use((sessionService) =>
    sessionService.validateSessionToken(request.cookies.session),
  );
  if (!result) {
    return yield* new HttpError(401, "Not authenticated");
  }
  return result;
});

// Billing date serialization helpers
function isDateLike(value: unknown): value is { toISOString(): string } {
  return typeof value === "object" && value !== null && "toISOString" in value;
}

function serializeBillingDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (isDateLike(value)) return value.toISOString();
  return String(value);
}

function serializeBillingDateShort(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isDateLike(value)) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function serializeBillResponse(bill: Selectable<AppPublicBills>): BillResponse {
  return {
    ...bill,
    billing_period_start: serializeBillingDateShort(bill.billing_period_start),
    billing_period_end: serializeBillingDateShort(bill.billing_period_end),
    due_date: bill.due_date ? serializeBillingDateShort(bill.due_date) : null,
    created_at: serializeBillingDate(bill.created_at)!,
    updated_at: serializeBillingDate(bill.updated_at)!,
    issued_at: bill.issued_at ? serializeBillingDate(bill.issued_at) : null,
    paid_at: bill.paid_at ? serializeBillingDate(bill.paid_at) : null,
    cancelled_at: bill.cancelled_at ? serializeBillingDate(bill.cancelled_at) : null,
    voided_at: bill.voided_at ? serializeBillingDate(bill.voided_at) : null,
  };
}

function serializePaymentResponse(p: Selectable<AppPublicPayments>): PaymentResponse {
  return {
    ...p,
    received_at: serializeBillingDate(p.received_at)!,
    created_at: serializeBillingDate(p.created_at)!,
    updated_at: serializeBillingDate(p.updated_at)!,
  };
}

function serializeCreditResponse(c: Selectable<AppPublicFamilyCredits>): FamilyCreditResponse {
  return {
    ...c,
    expires_at: c.expires_at ? serializeBillingDate(c.expires_at) : null,
    consumed_at: c.consumed_at ? serializeBillingDate(c.consumed_at) : null,
    created_at: serializeBillingDate(c.created_at)!,
  };
}

function serializeAdjustment(a: Selectable<AppPublicBillAdjustments>): AdjustmentResponse {
  return {
    id: a.id,
    bill_id: a.bill_id,
    amount_cents: a.amount_cents,
    reason: a.reason,
    created_at: serializeBillingDate(a.created_at)!,
  };
}

function serializeRefund(r: Selectable<AppPublicRefunds>): RefundResponse {
  return {
    id: r.id,
    payment_id: r.payment_id,
    amount_cents: r.amount_cents,
    reason: r.reason,
    created_by: r.created_by,
    refunded_at: serializeBillingDate(r.refunded_at)!,
    notes: r.notes,
    created_at: serializeBillingDate(r.created_at)!,
  };
}

function serializeCreditApplication(
  ca: Selectable<AppPublicFamilyCreditApplications>,
): CreditApplicationResponse {
  return {
    id: ca.id,
    credit_id: ca.credit_id,
    bill_id: ca.bill_id,
    amount_cents: ca.amount_cents,
    created_at: serializeBillingDate(ca.created_at)!,
  };
}

function serializeFamilyDiscount(d: Selectable<AppPublicFamilyDiscounts>): FamilyDiscountResponse {
  return {
    ...d,
    discount_type: d.discount_type as FamilyDiscountResponse["discount_type"],
    applies_to: d.applies_to as FamilyDiscountResponse["applies_to"],
    effective_from: serializeBillingDateShort(d.effective_from),
    effective_until: d.effective_until ? serializeBillingDateShort(d.effective_until) : null,
    created_at: serializeBillingDate(d.created_at)!,
    updated_at: serializeBillingDate(d.updated_at)!,
  };
}

function serializeTaxRate(r: Selectable<AppPublicTaxRates>): TaxRateResponse {
  return {
    ...r,
    rate_percent: Number(r.rate_percent),
    applies_to: r.applies_to as TaxRateResponse["applies_to"],
    effective_from: serializeBillingDateShort(r.effective_from),
    effective_until: r.effective_until ? serializeBillingDateShort(r.effective_until) : null,
    created_at: serializeBillingDate(r.created_at)!,
    updated_at: serializeBillingDate(r.updated_at)!,
  };
}

function serializeFamilyTaxExemption(
  e: Selectable<AppPublicFamilyTaxExemptions>,
): FamilyTaxExemptionResponse {
  return {
    ...e,
    effective_from: serializeBillingDateShort(e.effective_from),
    effective_until: e.effective_until ? serializeBillingDateShort(e.effective_until) : null,
    created_at: serializeBillingDate(e.created_at)!,
  };
}

function mapBillDetail(
  detail: {
    lineItems: readonly Selectable<AppPublicBillLineItems>[];
    adjustments: readonly Selectable<AppPublicBillAdjustments>[];
    creditApplications: readonly Selectable<AppPublicFamilyCreditApplications>[];
  },
  bill: Selectable<AppPublicBills>,
): BillDetailResponseType {
  return {
    ...serializeBillResponse(bill),
    line_items: detail.lineItems.map((li: Selectable<AppPublicBillLineItems>) => ({
      ...li,
      created_at: serializeBillingDate(li.created_at)!,
    })),
    adjustments: detail.adjustments.map((adj: Selectable<AppPublicBillAdjustments>) => ({
      ...adj,
      created_at: serializeBillingDate(adj.created_at)!,
    })),
    credit_applications: detail.creditApplications.map(
      (ca: Selectable<AppPublicFamilyCreditApplications>) => ({
        ...ca,
        created_at: serializeBillingDate(ca.created_at)!,
      }),
    ),
  };
}

export const adminGroup = adminClientGroup
  .add(HttpApiEndpoint.get("gcalConnect", "/api/admin/gcal/connect", { error: adminClientErrors }))
  .add(
    HttpApiEndpoint.get("gcalCallback", "/api/admin/gcal/callback", {
      error: adminClientErrors,
      query: GcalCallbackQuery,
    }),
  );

const materialDownloadErrors = [
  UnauthorizedErrorSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  InternalServerErrorSchema,
] as const;

export const materialDownloadGroup = HttpApiGroup.make("materialDownload")
  .add(
    HttpApiEndpoint.get("materialDownload", "/materials/:id/download", {
      error: materialDownloadErrors,
      params: params("id"),
    }),
  )
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
          const authorization = yield* GoogleCalendarService.use((googleCalendarService) =>
            googleCalendarService.createAuthorizationRequest(rootUrl),
          );
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
        Effect.fnUntraced(function* ({ request, query }) {
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
              HttpServerResponse.jsonUnsafe({ error: message }, { status }),
              authCookieName,
              cookieOptions,
            );
          if (query.error) {
            return yield* fail(400, `Google Calendar OAuth failed (${query.error})`);
          }
          if (!query.code || !query.state) {
            return yield* fail(400, "Missing Google Calendar OAuth callback parameters");
          }
          const code = query.code;
          if (!authState || authState.state !== query.state) {
            return yield* fail(400, "Invalid or expired Google Calendar OAuth state");
          }
          yield* GoogleCalendarService.use((googleCalendarService) =>
            googleCalendarService.handleCallback(rootUrl, code, authState.codeVerifier),
          );
          let response = HttpServerResponse.redirect(
            GoogleCalendarService.getConnectRedirectUrl(rootUrl, authState.redirect),
          );
          response = yield* HttpServerResponse.expireCookie(
            response,
            authCookieName,
            cookieOptions,
          );
          return response;
        }, adaptAdminErrors),
      )
      .handle(
        "submissions",
        Effect.fnUntraced(function* ({ request, query }) {
          const auth = yield* requireAdminSession(request);
          const rows = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.listSubmissions(
              auth.session.id,
              query.limit ?? 50,
              query.offset ?? 0,
            ),
          );
          return rows.map((row) => ({
            ...row,
            created_at: row.created_at.toISOString(),
          }));
        }, adaptAdminErrors),
      )
      .handle(
        "updateSubmission",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          const row = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.updateSubmissionRead(auth.session.id, params.id, payload.is_read),
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
          const rows = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.listStudents(auth.session.id),
          );
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
          const { params } = context;
          const raw = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.getStudent(auth.session.id, params.id),
          );
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
          return yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.listCourses(auth.session.id),
          );
        }, adaptAdminErrors),
      )
      .handle(
        "courseStudents",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { params } = context;
          const rows = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.listCourseStudents(auth.session.id, params.id),
          );
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
          return yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.createCourse(auth.session.id, {
              title: payload.title,
              description: payload.description ?? "",
              instrument: payload.instrument,
            }),
          );
        }, adaptAdminErrors),
      )
      .handle(
        "updateCourse",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          const updates: Record<string, string> = {};
          const title = payload.title;
          const description = payload.description;
          const instrument = payload.instrument;
          if (title !== undefined) updates.title = title;
          if (description !== undefined) updates.description = description;
          if (instrument !== undefined) updates.instrument = instrument;
          const course = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.updateCourse(auth.session.id, params.id, updates),
          );
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
          const { params } = context;
          yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.deleteCourse(auth.session.id, params.id),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "createModule",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          return yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.createModule(auth.session.id, params.id, {
              title: payload.title,
              sort_order: payload.sort_order ?? 0,
            }),
          );
        }, adaptAdminErrors),
      )
      .handle(
        "updateModule",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          return yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.updateModule(auth.session.id, params.id, payload),
          );
        }, adaptAdminErrors),
      )
      .handle(
        "deleteModule",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { params } = context;
          yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.deleteModule(auth.session.id, params.id),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "enrollStudent",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.enrollStudent(auth.session.id, params.id, payload.course_id),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "unenrollStudent",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { params } = context;
          yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.unenrollStudent(auth.session.id, params.id, params.courseId),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "assignMaterial",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.assignMaterial({
              sessionId: auth.session.id,
              studentId: params.id,
              materialId: payload.material_id,
              assignedTrackIndex: payload.assigned_track_index,
            }),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "unassignMaterial",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { params } = context;
          yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.unassignMaterial(auth.session.id, params.id, params.materialId),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "deleteMaterial",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { params } = context;
          const row = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.deleteMaterial(auth.session.id, params.id),
          );
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
          return (yield* FileService.use((fileService) =>
            fileService.upload(
              payload.file,
              payload.title,
              payload.is_global,
              auth.user.id,
              auth.session.id,
            ),
          )) as MaterialResponse;
        }, adaptAdminErrors),
      )
      .handle(
        "createFamily",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          const familyResult = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.createFamily(auth.session.id, {
              slug: payload.slug,
              name: payload.name,
            }),
          );
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
          const rows = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.listFamilies(auth.session.id),
          );
          return rows.map((row) => ({
            ...row,
            created_at: row.created_at.toISOString(),
          }));
        }, adaptAdminErrors),
      )
      .handle(
        "inviteFamily",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.inviteFamily(auth.session.id, params.familyId, {
              username: payload.username,
              email: payload.email,
              invitedRole: payload.invited_role,
            }),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "qrInvite",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          let familyId = params.familyId;
          if (familyId === "new") {
            const name = payload.name;
            const slug = payload.slug;
            if (!name || !slug) {
              return yield* new HttpError(
                400,
                "Name and slug are required when creating a new family",
              );
            }
            const family = yield* AdminRouteService.use((adminRouteService) =>
              adminRouteService.createQrInviteFamily(auth.session.id, {
                name,
                slug,
              }),
            );
            familyId = family.id;
          }
          const invitation = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.createQrInvite(familyId, payload.invited_role),
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
          const { params } = context;
          return (yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.listFamilyInvitations(auth.session.id, params.familyId),
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
          const lesson = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.createLesson({
              sessionId: auth.session.id,
              studentId: payload.student_id,
              scheduledAt: new Date(payload.scheduled_at),
              durationMinutes: payload.duration_minutes,
              locationType: payload.location_type,
              gcalEventId: null,
            }),
          );
          return serializeLesson(lesson);
        }, adaptAdminErrors),
      )
      .handle(
        "updateLesson",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          const updates: Record<string, unknown> = {};
          const scheduledAt = payload.scheduled_at;
          const durationMinutes = payload.duration_minutes;
          const locationType = payload.location_type;
          if (scheduledAt !== undefined) updates.scheduled_at = new Date(scheduledAt);
          if (durationMinutes !== undefined) updates.duration_minutes = durationMinutes;
          if (locationType !== undefined) updates.location_type = locationType;
          const lesson = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.updateLesson(auth.session.id, params.id, {
              scheduledAt: updates.scheduled_at as Date | undefined,
              durationMinutes: updates.duration_minutes as number | undefined,
              locationType: updates.location_type as LocationType | undefined,
            }),
          );
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
          const { params } = context;
          const lesson = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.deleteLesson(auth.session.id, params.id),
          );
          if (!lesson) {
            return yield* new HttpError(404, "Lesson not found");
          }
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "cancelLesson",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          const lesson = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.cancelLesson(auth.session.id, params.id, payload.reason ?? null),
          );
          return serializeLesson(lesson);
        }, adaptAdminErrors),
      )
      .handle(
        "completeLesson",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireAdminSession(request);
          const lesson = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.completeLesson(auth.session.id, params.id),
          );
          return serializeLesson(lesson);
        }, adaptAdminErrors),
      )
      .handle(
        "lessons",
        Effect.fnUntraced(function* ({ request, query }) {
          const auth = yield* requireAdminSession(request);
          const lessons = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.listLessons(auth.session.id, {
              limit: query.limit ?? 50,
              offset: query.offset ?? 0,
              studentId: query.student_id,
              status: query.status,
              from: query.from ? new Date(query.from) : undefined,
              to: query.to ? new Date(query.to) : undefined,
            }),
          );
          return lessons.map(serializeLesson);
        }, adaptAdminErrors),
      )
      .handle(
        "saveStudentRate",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          const rate = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.saveStudentRate({
              sessionId: auth.session.id,
              studentId: payload.student_id,
              rateCents: payload.rate_cents,
              lessonDurationMinutes: payload.lesson_duration_minutes,
              locationType: payload.location_type,
              billingModel: payload.billing_model,
              notes: payload.notes ?? null,
            }),
          );
          return {
            ...rate,
            created_at: rate.created_at.toISOString(),
          };
        }, adaptAdminErrors),
      )
      .handle(
        "studentRates",
        Effect.fnUntraced(function* ({ request, params, query }) {
          const auth = yield* requireAdminSession(request);
          return (yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.listStudentRates(
              auth.session.id,
              params.studentId,
              query.location_type,
            ),
          )).map((row) => ({
            ...row,
            created_at: row.created_at.toISOString(),
          }));
        }, adaptAdminErrors),
      )
      .handle(
        "recurringSchedules",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireAdminSession(request);
          const rows = yield* RecurringScheduleService.use((recurringScheduleService) =>
            recurringScheduleService.listSchedules(auth.session.id, params.studentId),
          );
          return rows.map(serializeRecurringSchedule);
        }, adaptAdminErrors),
      )
      .handle(
        "saveRecurringSchedule",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          const row = yield* RecurringScheduleService.use((recurringScheduleService) =>
            recurringScheduleService.saveSchedule({
              sessionId: auth.session.id,
              studentId: params.studentId,
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
            }),
          );
          return serializeRecurringSchedule(row);
        }, adaptAdminErrors),
      )
      .handle(
        "monthlyPayments",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireAdminSession(request);
          const rows = yield* RecurringScheduleService.use((recurringScheduleService) =>
            recurringScheduleService.listPayments(auth.session.id, params.studentId),
          );
          return rows.map(serializeMonthlyPayment);
        }, adaptAdminErrors),
      )
      .handle(
        "monthlyPaymentStatus",
        Effect.fnUntraced(function* ({ request, query }) {
          const auth = yield* requireAdminSession(request);
          const rows = yield* RecurringScheduleService.use((recurringScheduleService) =>
            recurringScheduleService.listMonth(auth.session.id, query.month),
          );
          return rows.map((row) => ({
            ...row,
            payment: row.payment === null ? null : serializeMonthlyPayment(row.payment),
          }));
        }, adaptAdminErrors),
      )
      .handle(
        "recordMonthlyPayment",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          const row = yield* RecurringScheduleService.use((recurringScheduleService) =>
            recurringScheduleService.recordPayment({
              sessionId: auth.session.id,
              studentId: params.studentId,
              billingMonth: payload.billing_month,
              amountCents: payload.amount_cents,
              paidAt: new Date(payload.paid_at),
              notes: payload.notes ?? null,
            }),
          );
          return serializeMonthlyPayment(row);
        }, adaptAdminErrors),
      )
      .handle(
        "saveLessonNote",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          const note = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.saveLessonNote(auth.session.id, params.id, {
              topicsCovered: payload.topics_covered ?? null,
              homework: payload.homework ?? null,
              progressObservations: payload.progress_observations ?? null,
              notes: payload.notes ?? null,
              materialIds: payload.material_ids ? [...payload.material_ids] : null,
              draft: payload.draft ?? true,
            }),
          );
          return serializeLessonNote(note);
        }, adaptAdminErrors),
      )
      .handle(
        "lessonNote",
        Effect.fnUntraced(function* (context) {
          const auth = yield* requireAdminSession(context.request);
          const { params } = context;
          const note = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.getLessonNote(auth.session.id, params.id),
          );
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
          const { params } = context;
          const note = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.publishLessonNote(auth.session.id, params.id),
          );
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
          const status = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.getGoogleCalendarStatus(),
          );
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
          yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.disconnectGoogleCalendar(),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "workingHours",
        Effect.fnUntraced(function* (context) {
          yield* requireAdminSession(context.request);
          return yield* GoogleCalendarService.use((googleCalendarService) =>
            googleCalendarService.getWorkingHours(),
          );
        }, adaptAdminErrors),
      )
      .handle(
        "cancellationPolicySettings",
        Effect.fnUntraced(function* ({ request }) {
          yield* requireAdminSession(request);
          return yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.getCancellationPolicySettings(),
          );
        }, adaptAdminErrors),
      )
      .handle(
        "saveCancellationPolicySettings",
        Effect.fnUntraced(function* ({ request, payload }) {
          yield* requireAdminSession(request);
          return yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.saveCancellationPolicySettings(payload),
          );
        }, adaptAdminErrors),
      )
      .handle(
        "saveWorkingHours",
        Effect.fnUntraced(function* ({ request, payload }) {
          yield* requireAdminSession(request);
          yield* GoogleCalendarService.use((googleCalendarService) =>
            googleCalendarService.setWorkingHours(payload),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "testimonialReminderInterval",
        Effect.fnUntraced(function* (context) {
          yield* requireAdminSession(context.request);
          return {
            interval_days: yield* TestimonialReminderService.use((testimonialReminderService) =>
              testimonialReminderService.getIntervalDays(),
            ),
          };
        }, adaptAdminErrors),
      )
      .handle(
        "saveTestimonialReminderInterval",
        Effect.fnUntraced(function* ({ request, payload }) {
          yield* requireAdminSession(request);
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
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
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
      )
      // ==================================================================
      // Admin Billing API
      // ==================================================================
      .handle(
        "billingFamilies",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireAdminSession(request);
          const summaries = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.listAllFamiliesWithBilling(auth.session.id),
          );
          const balances = yield* Effect.all(
            summaries.map((summary) =>
              BillingLedgerService.use((billingLedgerService) =>
                billingLedgerService.getFamilyBalance(auth.session.id, summary.family_id),
              ),
            ),
          );
          return summaries.map((summary, index) => ({
            ...summary,
            outstanding_cents: balances[index]?.outstandingCents ?? summary.outstanding_cents,
            overdue_cents: balances[index]?.overdueCents ?? summary.overdue_cents,
            credit_balance_cents:
              balances[index]?.creditBalanceCents ?? summary.credit_balance_cents,
          }));
        }, adaptAdminErrors),
      )
      .handle(
        "billingFamily",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireAdminSession(request);
          const detail = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.getFamilyBillingDetail(auth.session.id, params.familyId),
          );
          return {
            ...detail,
            bills: detail.bills.map(serializeBillResponse),
            payments: detail.payments.map(serializePaymentResponse),
            credits: detail.credits.map(serializeCreditResponse),
          };
        }, adaptAdminErrors),
      )
      .handle(
        "billingFamilyBills",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireAdminSession(request);
          const bills = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.listFamilyBills(auth.session.id, params.familyId),
          );
          return bills.map(serializeBillResponse);
        }, adaptAdminErrors),
      )
      .handle(
        "billingFamilyPayments",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireAdminSession(request);
          const payments = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.listFamilyPayments(auth.session.id, params.familyId),
          );
          return payments.map(serializePaymentResponse);
        }, adaptAdminErrors),
      )
      .handle(
        "billingFamilyCredits",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireAdminSession(request);
          const credits = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.listFamilyCredits(auth.session.id, params.familyId),
          );
          return credits.map(serializeCreditResponse);
        }, adaptAdminErrors),
      )
      .handle(
        "createBill",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          const bill = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.createBill(auth.session.id, {
              familyId: payload.family_id,
              billingPeriodStart: payload.billing_period_start,
              billingPeriodEnd: payload.billing_period_end,
              dueDate: payload.due_date,
              lineItems: payload.line_items.map(
                (li: {
                  student_id: string;
                  line_type: "lesson" | "single_booking" | "fee" | "adjustment" | "credit";
                  description: string;
                  quantity: number;
                  unit_price_cents: number;
                  amount_cents: number;
                }) => ({
                  studentId: li.student_id,
                  lineType: li.line_type,
                  description: li.description,
                  quantity: li.quantity,
                  unitPriceCents: li.unit_price_cents,
                  amountCents: li.amount_cents,
                }),
              ),
              notes: payload.notes,
            }),
          );
          const lineItems = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.billLineItems(auth.session.id, bill.id),
          );
          const result = {
            ...serializeBillResponse(bill),
            line_items: lineItems.map((li: Selectable<AppPublicBillLineItems>) => ({
              ...li,
              created_at: serializeBillingDate(li.created_at)!,
            })),
            adjustments: [],
            credit_applications: [],
          };
          return JSON.parse(JSON.stringify(result));
        }, adaptAdminErrors),
      )
      .handle(
        "getBill",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireAdminSession(request);
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.getBill(auth.session.id, params.id),
          );
          if (!result) {
            return yield* new HttpError(404, "Bill not found");
          }
          return mapBillDetail(result, result);
        }, adaptAdminErrors),
      )
      .handle(
        "issueBill",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireAdminSession(request);
          yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.issueBill(auth.session.id, params.id),
          );
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.getBill(auth.session.id, params.id),
          );
          if (!result) {
            return yield* new HttpError(404, "Bill not found");
          }
          return mapBillDetail(result, result);
        }, adaptAdminErrors),
      )
      .handle(
        "cancelBill",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireAdminSession(request);
          yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.cancelBill(auth.session.id, params.id),
          );
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.getBill(auth.session.id, params.id),
          );
          if (!result) {
            return yield* new HttpError(404, "Bill not found");
          }
          return mapBillDetail(result, result);
        }, adaptAdminErrors),
      )
      .handle(
        "voidBill",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.voidBill(auth.session.id, {
              billId: params.id,
              reason: payload.reason,
            }),
          );
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.getBill(auth.session.id, params.id),
          );
          if (!result) {
            return yield* new HttpError(404, "Bill not found");
          }
          return mapBillDetail(result, result);
        }, adaptAdminErrors),
      )
      .handle(
        "adjustBill",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.createAdjustment(auth.session.id, {
              billId: params.id,
              amountCents: payload.amount_cents,
              reason: payload.reason,
            }),
          );
          return serializeAdjustment(result);
        }, adaptAdminErrors),
      )
      .handle(
        "recordPayment",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.recordPayment(auth.session.id, {
              familyId: payload.family_id,
              amountCents: payload.amount_cents,
              method: payload.method,
              reference: payload.reference,
              receivedAt: payload.received_at ? new Date(payload.received_at) : undefined,
              notes: payload.notes,
              allocations: payload.allocations.map(
                (a: { bill_id: string; amount_cents: number }) => ({
                  billId: a.bill_id,
                  amountCents: a.amount_cents,
                }),
              ),
            }),
          );
          return serializePaymentResponse(result);
        }, adaptAdminErrors),
      )
      .handle(
        "refundPayment",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.processRefund(auth.session.id, {
              paymentId: params.id,
              amountCents: payload.amount_cents,
              reason: payload.reason,
            }),
          );
          return serializeRefund(result);
        }, adaptAdminErrors),
      )
      .handle(
        "createCredit",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.issueCredit(auth.session.id, {
              familyId: payload.family_id,
              studentId: payload.student_id,
              amountCents: payload.amount_cents,
              reason: payload.reason,
              expiresAt: payload.expires_at,
            }),
          );
          return serializeCreditResponse(result);
        }, adaptAdminErrors),
      )
      .handle(
        "applyCredit",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.applyCredit(auth.session.id, {
              creditId: payload.credit_id,
              billId: payload.bill_id,
              amountCents: payload.amount_cents,
            }),
          );
          return serializeCreditApplication(result);
        }, adaptAdminErrors),
      )
      .handle(
        "familyDiscounts",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireAdminSession(request);
          const discounts = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.listFamilyDiscounts(auth.session.id, params.familyId),
          );
          return discounts.map(serializeFamilyDiscount);
        }, adaptAdminErrors),
      )
      .handle(
        "createDiscount",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.createDiscount(auth.session.id, {
              familyId: payload.family_id,
              label: payload.label,
              discountType: payload.discount_type,
              discountValue: payload.discount_value,
              appliesTo: payload.applies_to,
              effectiveFrom: payload.effective_from,
              effectiveUntil: payload.effective_until,
            }),
          );
          return serializeFamilyDiscount(result);
        }, adaptAdminErrors),
      )
      .handle(
        "updateDiscount",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.updateDiscount(auth.session.id, params.id, {
              label: payload.label,
              discountType: payload.discount_type,
              discountValue: payload.discount_value,
              appliesTo: payload.applies_to,
              effectiveFrom: payload.effective_from,
              effectiveUntil: payload.effective_until,
              isActive: payload.is_active,
            }),
          );
          return serializeFamilyDiscount(result);
        }, adaptAdminErrors),
      )
      .handle(
        "listTaxRates",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireAdminSession(request);
          const rates = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.listTaxRates(auth.session.id),
          );
          return rates.map(serializeTaxRate);
        }, adaptAdminErrors),
      )
      .handle(
        "createTaxRate",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.createTaxRate(auth.session.id, {
              label: payload.label,
              jurisdiction: payload.jurisdiction,
              ratePercent: payload.rate_percent,
              appliesTo: payload.applies_to,
              effectiveFrom: payload.effective_from,
              effectiveUntil: payload.effective_until,
            }),
          );
          return serializeTaxRate(result);
        }, adaptAdminErrors),
      )
      .handle(
        "familyTaxExemptions",
        Effect.fnUntraced(function* ({ request, params }) {
          const auth = yield* requireAdminSession(request);
          const exemptions = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.listFamilyTaxExemptions(auth.session.id, params.familyId),
          );
          return exemptions.map(serializeFamilyTaxExemption);
        }, adaptAdminErrors),
      )
      .handle(
        "createTaxExemption",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.createTaxExemption(auth.session.id, {
              familyId: payload.family_id,
              taxRateId: payload.tax_rate_id,
              exemptionReason: payload.exemption_reason,
              effectiveFrom: payload.effective_from,
              effectiveUntil: payload.effective_until,
            }),
          );
          return serializeFamilyTaxExemption(result);
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
        const { params } = context;
        const fileInfo = yield* FileService.use((fileService) =>
          fileService.download(params.id, auth.user.id, auth.session.id),
        );
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
