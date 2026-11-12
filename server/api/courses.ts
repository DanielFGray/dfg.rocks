import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
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
          courseService.courses(filterStudentId).pipe(withAuthContext(auth.session.id)),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "courseById",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        return yield* CourseService.use((courseService) =>
          courseService.courseById(params.id).pipe(withAuthContext(auth.session.id)),
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
          courseService.listCourses().pipe(withAuthContext(auth.session.id)),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "courseStudents",
      Effect.fnUntraced(function* (context) {
        const auth = yield* CurrentSession;
        const { params } = context;
        const rows = yield* CourseService.use((courseService) =>
          courseService.listCourseStudents(params.id).pipe(withAuthContext(auth.session.id)),
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
          courseService
            .createCourse({
              title: payload.title,
              description: payload.description ?? "",
              instrument: payload.instrument,
            })
            .pipe(withAuthContext(auth.session.id)),
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
          courseService.updateCourse(params.id, updates).pipe(withAuthContext(auth.session.id)),
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
          courseService.deleteCourse(params.id).pipe(withAuthContext(auth.session.id)),
        );
        return { success: true as const };
      }, adaptAdminErrors),
    )
    .handle(
      "createModule",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        return yield* CourseService.use((courseService) =>
          courseService
            .createModule(params.id, {
              title: payload.title,
              sort_order: payload.sort_order ?? 0,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "updateModule",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        return yield* CourseService.use((courseService) =>
          courseService.updateModule(params.id, payload).pipe(withAuthContext(auth.session.id)),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "deleteModule",
      Effect.fnUntraced(function* (context) {
        const auth = yield* CurrentSession;
        const { params } = context;
        yield* CourseService.use((courseService) =>
          courseService.deleteModule(params.id).pipe(withAuthContext(auth.session.id)),
        );
        return { success: true as const };
      }, adaptAdminErrors),
    )
    .handle(
      "enrollStudent",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        yield* CourseService.use((courseService) =>
          courseService
            .enrollStudent(params.id, payload.course_id)
            .pipe(withAuthContext(auth.session.id)),
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
          courseService
            .unenrollStudent(params.id, params.courseId)
            .pipe(withAuthContext(auth.session.id)),
        );
        return { success: true as const };
      }, adaptAdminErrors),
    ),
);
