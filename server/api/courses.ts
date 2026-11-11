import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { HttpError } from "../pgErrors.js";
import { CourseService } from "../services/courseService.js";
import { resolveEffectiveStudent } from "../services/sessionService.js";
import { adaptSignedInErrors, adaptAdminErrors } from "../httpApiErrors.js";

export const CoursesApiGroupLive = HttpApiBuilder.group(Contract, "courses", (handlers) =>
  handlers
    .handle(
      "courses",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const filterStudentId = effective.isActing ? effective.studentId : undefined;
        return yield* CourseService.use((courseService) =>
          courseService.courses(auth.session.id, filterStudentId),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "courseById",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        return yield* CourseService.use((courseService) =>
          courseService.courseById(auth.session.id, params.id),
        );
      }, adaptSignedInErrors),
    ),
);

export const CoursesAdminApiGroupLive = HttpApiBuilder.group(Contract, "coursesAdmin", (handlers) =>
  handlers
    .handle(
      "courses",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        return yield* CourseService.use((courseService) =>
          courseService.listCourses(auth.session.id),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "courseStudents",
      Effect.fnUntraced(function* (context) {
        const auth = yield* CurrentSession;
        const { params } = context;
        const rows = yield* CourseService.use((courseService) =>
          courseService.listCourseStudents(auth.session.id, params.id),
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
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        return yield* CourseService.use((courseService) =>
          courseService.createCourse(auth.session.id, {
            title: payload.title,
            description: payload.description ?? "",
            instrument: payload.instrument,
          }),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "updateCourse",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const updates: Record<string, string> = {};
        const title = payload.title;
        const description = payload.description;
        const instrument = payload.instrument;
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (instrument !== undefined) updates.instrument = instrument;
        const course = yield* CourseService.use((courseService) =>
          courseService.updateCourse(auth.session.id, params.id, updates),
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
        const auth = yield* CurrentSession;
        const { params } = context;
        yield* CourseService.use((courseService) =>
          courseService.deleteCourse(auth.session.id, params.id),
        );
        return { success: true as const };
      }, adaptAdminErrors),
    )
    .handle(
      "createModule",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        return yield* CourseService.use((courseService) =>
          courseService.createModule(auth.session.id, params.id, {
            title: payload.title,
            sort_order: payload.sort_order ?? 0,
          }),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "updateModule",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        return yield* CourseService.use((courseService) =>
          courseService.updateModule(auth.session.id, params.id, payload),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "deleteModule",
      Effect.fnUntraced(function* (context) {
        const auth = yield* CurrentSession;
        const { params } = context;
        yield* CourseService.use((courseService) =>
          courseService.deleteModule(auth.session.id, params.id),
        );
        return { success: true as const };
      }, adaptAdminErrors),
    )
    .handle(
      "enrollStudent",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        yield* CourseService.use((courseService) =>
          courseService.enrollStudent(auth.session.id, params.id, payload.course_id),
        );
        return { success: true as const };
      }, adaptAdminErrors),
    )
    .handle(
      "unenrollStudent",
      Effect.fnUntraced(function* (context) {
        const auth = yield* CurrentSession;
        const { params } = context;
        yield* CourseService.use((courseService) =>
          courseService.unenrollStudent(auth.session.id, params.id, params.courseId),
        );
        return { success: true as const };
      }, adaptAdminErrors),
    ),
);
