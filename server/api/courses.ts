import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { HttpError } from "../pgErrors.js";
import { AuthenticatedRouteService } from "../services/authenticatedRouteService.js";
import { resolveEffectiveStudent } from "../services/sessionService.js";
import { requireSession, requireAdminSession } from "./raw.js";
import { AdminRouteService } from "../services/adminRouteService.js";
import { adaptSignedInErrors, adaptAdminErrors } from "../httpApiErrors.js";

export const CoursesApiGroupLive = HttpApiBuilder.group(Contract, "courses", (handlers) =>
  handlers
    .handle(
      "courses",
      Effect.fnUntraced(function* ({ request }) {
        const auth = yield* requireSession(request);
        const effective = resolveEffectiveStudent(auth);
        const filterStudentId = effective.isActing ? effective.studentId : undefined;
        return yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.courses(auth.session.id, filterStudentId),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "courseById",
      Effect.fnUntraced(function* ({ request, params }) {
        const auth = yield* requireSession(request);
        return yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.courseById(auth.session.id, params.id),
        );
      }, adaptSignedInErrors),
    ),
);

export const CoursesAdminApiGroupLive = HttpApiBuilder.group(Contract, "coursesAdmin", (handlers) =>
  handlers
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
    ),
);
