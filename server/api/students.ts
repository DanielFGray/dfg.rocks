import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { HttpError } from "../pgErrors.js";
import { requireSession, requireAdminSession } from "./raw.js";
import { AdminRouteService } from "../services/adminRouteService.js";
import { adaptAdminErrors } from "../httpApiErrors.js";

export const StudentsStaffApiGroupLive = HttpApiBuilder.group(
  Contract,
  "studentsStaff",
  (handlers) =>
    handlers
      .handle(
        "students",
        Effect.fnUntraced(function* ({ request }) {
          const auth = yield* requireSession(request);
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
          const auth = yield* requireSession(context.request);
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
      ),
);

export const StudentsAdminApiGroupLive = HttpApiBuilder.group(
  Contract,
  "studentsAdmin",
  (handlers) =>
    handlers
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
      ),
);
