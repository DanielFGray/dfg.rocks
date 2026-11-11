import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
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
            studentService.listStudents(auth.session.id),
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
            studentService.getStudent(auth.session.id, params.id),
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
            studentService.saveStudentRate({
              sessionId: auth.session.id,
              studentId: payload.student_id,
              rateCents: payload.rate_cents,
              lessonDurationMinutes: payload.lesson_duration_minutes,
              locationType: payload.location_type,
              billingModel: payload.billing_model,
              notes: payload.notes ?? null,
            }),
          );
          return rate;
        }, adaptAdminErrors),
      )
      .handle(
        "studentRates",
        Effect.fnUntraced(function* ({ params, query }) {
          const auth = yield* CurrentSession;
          return yield* StudentService.use((studentService) =>
            studentService.listStudentRates(auth.session.id, params.studentId, query.location_type),
          );
        }, adaptAdminErrors),
      ),
);
