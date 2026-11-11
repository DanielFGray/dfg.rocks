import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { HttpError } from "../pgErrors.js";
import { PracticeService } from "../services/practiceService.js";
import { resolveEffectiveStudent } from "../services/sessionService.js";
import { adaptSignedInErrors, adaptAdminErrors } from "../httpApiErrors.js";

export const PracticeApiGroupLive = HttpApiBuilder.group(Contract, "practice", (handlers) =>
  handlers
    .handle(
      "practiceLogs",
      Effect.fnUntraced(function* ({ query }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const filterStudentId = effective.isActing ? effective.studentId : undefined;
        const rows = yield* PracticeService.use((practiceService) =>
          practiceService.practiceLogs(auth.session.id, query.material_id, filterStudentId),
        );
        return rows;
      }, adaptSignedInErrors),
    )
    .handle(
      "createPracticeLog",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const row = yield* PracticeService.use((practiceService) =>
          practiceService.createPracticeLog({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            materialId: payload.material_id,
            rating: payload.rating,
            durationMinutes: payload.duration_minutes,
          }),
        );
        return row;
      }, adaptSignedInErrors),
    )
    .handle(
      "ratePracticeLog",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const row = yield* PracticeService.use((practiceService) =>
          practiceService.ratePracticeLog(
            auth.session.id,
            effective.studentId,
            payload.material_id,
            payload.rating,
          ),
        );
        return row;
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
          const rows = yield* PracticeService.use((practiceService) =>
            practiceService.listSubmissions(auth.session.id, query.limit ?? 50, query.offset ?? 0),
          );
          return rows;
        }, adaptAdminErrors),
      )
      .handle(
        "updateSubmission",
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          const row = yield* PracticeService.use((practiceService) =>
            practiceService.updateSubmissionRead(auth.session.id, params.id, payload.is_read),
          );
          if (!row) {
            return yield* new HttpError(404, "Submission not found");
          }
          return { success: true as const };
        }, adaptAdminErrors),
      ),
);
