import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { HttpError } from "../pgErrors.js";
import { AuthenticatedRouteService } from "../services/authenticatedRouteService.js";
import { resolveEffectiveStudent } from "../services/sessionService.js";
import { AdminRouteService } from "../services/adminRouteService.js";
import { adaptSignedInErrors, adaptAdminErrors } from "../httpApiErrors.js";

export const PracticeApiGroupLive = HttpApiBuilder.group(Contract, "practice", (handlers) =>
  handlers
    .handle(
      "practiceLogs",
      Effect.fnUntraced(function* ({ query }) {
        const auth = yield* CurrentSession;
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
      }, adaptSignedInErrors),
    )
    .handle(
      "createPracticeLog",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
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
      }, adaptSignedInErrors),
    )
    .handle(
      "ratePracticeLog",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
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
      }, adaptSignedInErrors),
    ),
);

export const PracticeAdminApiGroupLive = HttpApiBuilder.group(
  Contract,
  "practiceAdmin",
  (handlers) =>
    handlers
      .handle(
        "submissions",
        Effect.fnUntraced(function* ({ query }) {
          const auth = yield* CurrentSession;
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
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          const row = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.updateSubmissionRead(auth.session.id, params.id, payload.is_read),
          );
          if (!row) {
            return yield* new HttpError(404, "Submission not found");
          }
          return { success: true as const };
        }, adaptAdminErrors),
      ),
);
