import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { Students } from "../services/students.js";
import { adaptAdminErrors } from "../httpApiErrors.js";

export const StudentsAdminApiGroupLive = HttpApiBuilder.group(
  Contract,
  "studentsAdmin",
  (handlers) =>
    handlers
      .handle(
        "saveStudentRate",
        Effect.fnUntraced(function* ({ payload }) {
          const auth = yield* CurrentSession;
          const rate = yield* Students.use((studentService) =>
            studentService
              .saveStudentRate({
                studentId: payload.student_id,
                rateCents: payload.rate_cents,
                lessonDurationMinutes: payload.lesson_duration_minutes,
                locationType: payload.location_type,
                billingModel: payload.billing_model,
                notes: payload.notes ?? null,
              })
              .pipe(withAuthContext(auth.session.id)),
          );
          return rate;
        }, adaptAdminErrors),
      )
      .handle(
        "studentRates",
        Effect.fnUntraced(function* ({ params, query }) {
          const auth = yield* CurrentSession;
          return yield* Students.use((studentService) =>
            studentService
              .listStudentRates(params.studentId, query.location_type)
              .pipe(withAuthContext(auth.session.id)),
          );
        }, adaptAdminErrors),
      ),
);
