import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { StudentService } from "../services/studentService.js";
import { adaptAdminErrors } from "../httpApiErrors.js";

export const StudentsStaffApiGroupLive = HttpApiBuilder.group(
  Contract,
  "studentsStaff",
  (handlers) =>
    handlers
      .handle(
        "students",
        Effect.fnUntraced(function* () {
          const auth = yield* CurrentSession;
          const rows = yield* StudentService.use((studentService) =>
            studentService.listStudents().pipe(withAuthContext(auth.session.id)),
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
          const auth = yield* CurrentSession;
          const { params } = context;
          const raw = yield* StudentService.use((studentService) =>
            studentService.getStudent(params.id).pipe(withAuthContext(auth.session.id)),
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
        Effect.fnUntraced(function* ({ payload }) {
          const auth = yield* CurrentSession;
          const rate = yield* StudentService.use((studentService) =>
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
          return yield* StudentService.use((studentService) =>
            studentService
              .listStudentRates(params.studentId, query.location_type)
              .pipe(withAuthContext(auth.session.id)),
          );
        }, adaptAdminErrors),
      ),
);
