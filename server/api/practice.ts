import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { HttpError } from "../pgErrors.js";
import { Practice } from "../services/practice.js";
import { resolveEffectiveStudent } from "../services/sessions.js";
import { adaptSignedInErrors, adaptAdminErrors } from "../httpApiErrors.js";

export const PracticeApiGroupLive = HttpApiBuilder.group(Contract, "practice", (handlers) =>
  handlers
    .handle(
      "practiceLogs",
      Effect.fnUntraced(function* ({ query }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const filterStudentId = effective.isActing ? effective.studentId : undefined;
        const rows = yield* Practice.use((practiceService) =>
          practiceService
            .practiceLogs(query.material_id, filterStudentId)
            .pipe(withAuthContext(auth.session.id)),
        );
        return rows;
      }, adaptSignedInErrors),
    )
    .handle(
      "createPracticeLog",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const row = yield* Practice.use((practiceService) =>
          practiceService
            .createPracticeLog({
              studentId: effective.studentId,
              materialId: payload.material_id,
              rating: payload.rating,
              durationMinutes: payload.duration_minutes,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return row;
      }, adaptSignedInErrors),
    )
    .handle(
      "ratePracticeLog",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const row = yield* Practice.use((practiceService) =>
          practiceService
            .ratePracticeLog(effective.studentId, payload.material_id, payload.rating)
            .pipe(withAuthContext(auth.session.id)),
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
          const rows = yield* Practice.use((practiceService) =>
            practiceService
              .listSubmissions(query.limit ?? 50, query.offset ?? 0)
              .pipe(withAuthContext(auth.session.id)),
          );
          return rows;
        }, adaptAdminErrors),
      )
      .handle(
        "updateSubmission",
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          const row = yield* Practice.use((practiceService) =>
            practiceService
              .updateSubmissionRead(params.id, payload.is_read)
              .pipe(withAuthContext(auth.session.id)),
          );
          if (!row) {
            return yield* new HttpError({ status: 404, message: "Submission not found" });
          }
          return { success: true as const };
        }, adaptAdminErrors),
      ),
);
