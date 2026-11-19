import { Effect, Option } from "effect";
import { withAuthContext } from "../../server/requestDatabase.js";
import * as S from "effect/Schema";
import { useState } from "react";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { useForm } from "@tanstack/react-form";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/hooks/useAuth.js";
import { requiredValidator } from "../lib/validators.js";
import { fieldError } from "../lib/form.js";
import type { CourseDetail, Module, ModuleWithMaterials, User } from "../../shared/schemas.js";
import { PortalNav } from "../components/PortalNav.js";
import { CourseFormModal } from "../components/CourseFormModal.js";
import { ModuleCard } from "../components/courses/ModuleCard.js";
import { EnrolledStudents } from "../components/courses/EnrolledStudents.js";
import { Button } from "../components/ui/Button.js";
import { ComboBox } from "../components/ui/ComboBox.js";
import { Modal } from "../components/ui/Modal.js";
import { ConfirmDialog } from "../components/ui/ConfirmDialog.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { Input } from "../components/ui/Input.js";
import { Main } from "../components/ui/Container.js";
import { SubscribeCallout } from "../components/subscriptions/SubscribeCallout.js";
import { normalizeLoginRedirect } from "../lib/loginRedirect.js";
import { runServerEffect } from "../lib/serverEffect.js";
import { normalizeStudents, serializeCourseDetail } from "../../shared/responseMappers.js";
import { Sessions } from "../../server/services/sessions.js";
import { Courses } from "../../server/services/courses.js";
import { People } from "../../server/services/people.js";

type CourseDetailLoaded = {
  kind: "loaded";
  signedIn: boolean;
  course: CourseDetail & { modules: readonly ModuleWithMaterials[] };
  enrolledStudents: readonly User[];
  allStudents: readonly User[];
};

// Anyone may read a public course, with or without an account. A course the reader may not read is
// hidden by row security, so it is `locked` for a signed-in reader and `sign-in` for a visitor with
// no account (the route sends that visitor to sign in), or `missing` when it does not exist. A
// missing course leads the route to its not-found page.
type CourseDetailPageData =
  | CourseDetailLoaded
  | { kind: "locked"; signedIn: true }
  | { kind: "sign-in" }
  | { kind: "missing" };

const CourseId = S.String.pipe(S.check(S.isUUID()));

const getCourseDetailData = createServerFn({ method: "GET" })
  .validator(S.toStandardSchemaV1(S.Struct({ courseId: S.String })))
  .handler(({ data }) =>
    runServerEffect(
      Effect.gen(function* () {
        // No session is a visitor with no account, not an error: a public course is theirs to read.
        const session = yield* Sessions.use((sessions) =>
          sessions.validateSessionToken(getCookie("session")),
        );
        const isAdmin = session?.user.role === "admin";
        const signedIn = session !== null;
        // A course id that is not a uuid names no course, so it is missing without a query.
        return yield* Option.match(S.decodeOption(CourseId)(data.courseId), {
          onNone: () => Effect.succeed({ kind: "missing" } satisfies CourseDetailPageData),
          onSome: (courseId) =>
            Effect.gen(function* () {
              const course = yield* Courses.use((courseService) =>
                courseService.courseById(courseId),
              ).pipe(
                Effect.asSome,
                Effect.catchIf(
                  (error) => error._tag === "HttpError" && error.status === 404,
                  () => Effect.succeedNone,
                ),
              );
              return yield* Option.match(course, {
                onNone: () =>
                  Effect.gen(function* () {
                    // Admins read every course, so only a reader who is not an admin can be locked out.
                    const exists = yield* Courses.use((courseService) =>
                      courseService.courseExists(courseId),
                    );
                    return (
                      !exists || isAdmin
                        ? { kind: "missing" }
                        : signedIn
                          ? { kind: "locked", signedIn: true }
                          : { kind: "sign-in" }
                    ) satisfies CourseDetailPageData;
                  }),
                onSome: (loadedCourse) =>
                  Effect.gen(function* () {
                    if (!isAdmin) {
                      return {
                        kind: "loaded",
                        signedIn,
                        course: serializeCourseDetail(loadedCourse),
                        enrolledStudents: [],
                        allStudents: [],
                      } satisfies CourseDetailPageData;
                    }
                    const [enrolledStudents, allStudents] = yield* Effect.all([
                      Courses.use((courseService) => courseService.listCourseStudents(courseId)),
                      People.use((people) => people.listPeople("student")),
                    ]);
                    return {
                      kind: "loaded",
                      signedIn,
                      course: serializeCourseDetail(loadedCourse),
                      enrolledStudents: normalizeStudents(enrolledStudents),
                      allStudents: normalizeStudents(allStudents),
                    } satisfies CourseDetailPageData;
                  }),
              });
            }).pipe(withAuthContext(session?.session.id)),
        });
      }),
    ),
  );

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

// This route sits outside the sign-in gate so a visitor can read a public course. Its loader sends
// a visitor to sign in for any other course. The page renders on the client, where the signed-in
// account is read, as the gated routes do.
export const Route = createFileRoute("/courses/$id")({
  ssr: "data-only",
  head: () => ({ meta: [{ title: "Course Detail | DFG Portal" }] }),
  loader: async ({ params, location }) => {
    const data = await getCourseDetailData({ data: { courseId: params.id } });
    if (data.kind === "missing") throw notFound();
    if (data.kind === "sign-in") {
      throw redirect({
        to: "/login",
        search: { redirect: normalizeLoginRedirect(location.href) },
      });
    }
    return data;
  },
  component: CourseDetailPage,
  pendingComponent: () => <div>Loading...</div>,
});

function CourseDetailPage() {
  const data = Route.useLoaderData();
  // The portal navigation is for an account; a visitor reads the course alone.
  if (data.kind === "locked") {
    return (
      <>
        <PortalNav />
        <Main data-testid="course-locked">
          <h1 className="mb-8 text-3xl font-bold tracking-tight">Course</h1>
          <SubscribeCallout message="This course is part of a subscription." />
        </Main>
      </>
    );
  }
  return (
    <>
      {data.signedIn ? <PortalNav /> : null}
      <CourseDetailView
        signedIn={data.signedIn}
        course={data.course}
        enrolledStudents={data.enrolledStudents}
        allStudents={data.allStudents}
      />
    </>
  );
}

function CourseDetailView({
  signedIn,
  course,
  enrolledStudents,
  allStudents,
}: Omit<CourseDetailLoaded, "kind">) {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  const { isAdmin } = useAuth();

  const enrolledIds = new Set((enrolledStudents ?? []).map((s: User) => s.id));
  const availableStudents = (allStudents ?? []).filter((s: User) => !enrolledIds.has(s.id));

  const enrollStudentOptions = [
    { value: "", label: "Select a student..." },
    ...availableStudents.map((s: User) => ({
      value: s.id,
      label: `${s.name} (@${s.username})`,
    })),
  ];

  // ---- Modal state ----
  const [editCourseOpen, setEditCourseOpen] = useState(false);
  const [addModuleOpen, setAddModuleOpen] = useState(false);
  const [deleteModuleTarget, setDeleteModuleTarget] = useState<Module | null>(null);
  const [enrollStudentOpen, setEnrollStudentOpen] = useState(false);
  const [unenrollStudentTarget, setUnenrollStudentTarget] = useState<User | null>(null);

  // ---- Mutations ----
  const createModuleMutation = useMutation({
    mutationFn: (payload: { title: string }) =>
      Effect.runPromise(api.coursesAdmin.createModule({ params: { id }, payload })),
    onSuccess: (data) => {
      navigate({
        to: "/courses/$courseId/modules/$moduleId/edit",
        params: { courseId: id, moduleId: data.id },
      });
    },
  });

  const deleteModuleMutation = useMutation({
    mutationFn: (moduleId: string) =>
      Effect.runPromise(api.coursesAdmin.deleteModule({ params: { id: moduleId } })),
    onSettled: () => void router.invalidate(),
  });

  const enrollStudentMutation = useMutation({
    mutationFn: (studentId: string) =>
      Effect.runPromise(
        api.coursesAdmin.enrollStudent({
          params: { id: studentId },
          payload: { course_id: id },
        }),
      ),
    onSettled: () => void router.invalidate(),
  });

  const unenrollStudentMutation = useMutation({
    mutationFn: (studentId: string) =>
      Effect.runPromise(
        api.coursesAdmin.unenrollStudent({
          params: { id: studentId, courseId: id },
        }),
      ),
    onSettled: () => void router.invalidate(),
  });

  // ---- Forms ----
  const enrollForm = useForm({
    defaultValues: { student_id: "" },
    onSubmit: async ({ value }) => {
      if (!value.student_id) return;
      enrollStudentMutation.mutate(value.student_id, {
        onSuccess: () => setEnrollStudentOpen(false),
      });
    },
  });

  const addModuleForm = useForm({
    defaultValues: { title: "" },
    onSubmit: async ({ value }) => {
      createModuleMutation.mutate({ title: value.title });
    },
  });

  // ---- Edit Course handlers ----
  const openEditCourse = () => setEditCourseOpen(true);
  const closeEditCourse = () => setEditCourseOpen(false);

  // ---- Add Module handlers ----
  const openAddModule = () => {
    addModuleForm.reset({ title: "" });
    setAddModuleOpen(true);
  };
  const closeAddModule = () => setAddModuleOpen(false);

  // ---- Delete module handlers ----
  const openDeleteModule = (mod: Module) => setDeleteModuleTarget(mod);
  const closeDeleteModule = () => setDeleteModuleTarget(null);

  const confirmDeleteModule = () => {
    if (!deleteModuleTarget) return;
    deleteModuleMutation.mutate(deleteModuleTarget.id, {
      onSuccess: () => setDeleteModuleTarget(null),
    });
  };

  // ---- Enroll/unenroll handlers ----
  const openEnrollStudent = () => {
    enrollForm.reset({ student_id: "" });
    setEnrollStudentOpen(true);
  };
  const closeEnrollStudent = () => setEnrollStudentOpen(false);

  const cancelUnenrollStudent = () => setUnenrollStudentTarget(null);

  const confirmUnenrollStudent = () => {
    if (!unenrollStudentTarget) return;
    unenrollStudentMutation.mutate(unenrollStudentTarget.id, {
      onSuccess: () => setUnenrollStudentTarget(null),
    });
  };

  return (
    <main className="mx-auto max-w-[900px] px-5 pt-20 pb-16 md:px-8">
      {/* ---- Back link + title ---- */}
      <div className="mb-8">
        {signedIn ? (
          <div className="mb-2 flex items-center gap-3">
            <Link
              to="/courses"
              className="text-sm text-muted no-underline transition-colors hover:text-primary dark:text-muted-dark dark:hover:text-primary-dark"
            >
              &larr; Courses
            </Link>
          </div>
        ) : null}
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold tracking-tight">{course.title}</h1>
          {isAdmin ? (
            <Button
              variant="ghost"
              onClick={openEditCourse}
              data-testid="edit-course"
              className="px-3 py-1.5 text-xs"
            >
              Edit Course
            </Button>
          ) : null}
        </div>
        <p className="mt-2 text-muted dark:text-muted-dark">
          <span className="font-medium text-accent">{course.instrument}</span> &mdash;{" "}
          {course.description}
        </p>
      </div>

      {/* ---- Admin: Add Module button ---- */}
      {isAdmin ? (
        <div className="mb-6 flex justify-end">
          <Button variant="outline" onClick={openAddModule} data-testid="add-module">
            + Add Module
          </Button>
        </div>
      ) : null}

      {/* ---- Modules list ---- */}
      {course.modules.length === 0 ? (
        isAdmin ? (
          <EmptyState
            message="No modules yet."
            action={{ label: "Add Module", onClick: openAddModule }}
          />
        ) : (
          <p className="py-8 text-center text-muted dark:text-muted-dark">No modules yet.</p>
        )
      ) : (
        <div className="-mx-5 flex flex-col gap-5 md:mx-0">
          {course.modules.map((mod: ModuleWithMaterials) => (
            <ModuleCard
              key={mod.id}
              mod={mod}
              courseId={id}
              isAdmin={isAdmin}
              onDelete={openDeleteModule}
            />
          ))}
        </div>
      )}

      {/* ---- Enrolled Students (admin) ---- */}
      {isAdmin ? (
        <EnrolledStudents
          enrolledStudents={enrolledStudents ? [...enrolledStudents] : []}
          availableStudents={availableStudents}
          onEnroll={openEnrollStudent}
          onUnenroll={(s) => setUnenrollStudentTarget(s)}
        />
      ) : null}

      {/* ---- Enroll Student Modal ---- */}
      {isAdmin ? (
        <Modal open={enrollStudentOpen} onClose={closeEnrollStudent} title="Enroll Student">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enrollForm.handleSubmit();
            }}
            data-testid="enroll-student-form"
            className="flex flex-col gap-4"
          >
            <enrollForm.Field name="student_id" validators={requiredValidator}>
              {(field) => (
                <ComboBox
                  id="enroll-student-select"
                  name="student_id"
                  label="Student"
                  options={enrollStudentOptions.filter((o) => o.value !== "")}
                  value={field.state.value}
                  onChange={(v) => field.handleChange(v)}
                  onBlur={() => field.handleBlur()}
                  error={fieldError(field.state.meta.errors)}
                />
              )}
            </enrollForm.Field>
            <div className="mt-2 flex justify-end gap-3">
              <Button variant="ghost" onClick={closeEnrollStudent}>
                Cancel
              </Button>
              <Button type="submit">Enroll</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {/* ---- Unenroll Student Confirm ---- */}
      {isAdmin ? (
        <ConfirmDialog
          open={unenrollStudentTarget !== null}
          title="Unenroll Student"
          message={
            unenrollStudentTarget ? `Remove ${unenrollStudentTarget.name} from this course?` : ""
          }
          confirmLabel="Unenroll"
          variant="danger"
          onConfirm={confirmUnenrollStudent}
          onCancel={cancelUnenrollStudent}
        />
      ) : null}

      {/* ---- Edit Course Modal ---- */}
      {isAdmin ? (
        <CourseFormModal
          open={editCourseOpen}
          onClose={closeEditCourse}
          course={course}
          onSuccess={() => void router.invalidate()}
        />
      ) : null}

      {/* ---- Add Module Modal ---- */}
      {isAdmin ? (
        <Modal open={addModuleOpen} onClose={closeAddModule} title="Add Module">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addModuleForm.handleSubmit();
            }}
            data-testid="module-form"
            className="flex flex-col gap-5"
          >
            <addModuleForm.Field name="title" validators={requiredValidator}>
              {(field) => (
                <Input
                  id="module-title"
                  name="title"
                  label="Title"
                  value={field.state.value}
                  onChange={(v) => field.handleChange(v)}
                  onBlur={() => field.handleBlur()}
                  error={fieldError(field.state.meta.errors)}
                  placeholder="Module title"
                />
              )}
            </addModuleForm.Field>
            <div className="mt-2 flex justify-end gap-3">
              <Button variant="ghost" onClick={closeAddModule}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={createModuleMutation.isPending}>
                {createModuleMutation.isPending ? "Creating..." : "Create & Edit"}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {/* ---- Delete Module Confirm Dialog ---- */}
      {isAdmin ? (
        <ConfirmDialog
          open={deleteModuleTarget !== null}
          onConfirm={confirmDeleteModule}
          onCancel={closeDeleteModule}
          title="Delete Module"
          message={
            deleteModuleTarget
              ? `Are you sure you want to delete "${deleteModuleTarget.title}"? This cannot be undone.`
              : ""
          }
          confirmLabel="Delete"
          variant="danger"
        />
      ) : null}
    </main>
  );
}
