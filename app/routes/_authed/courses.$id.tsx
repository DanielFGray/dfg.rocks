import { Effect } from "effect";
import * as S from "effect/Schema";
import { useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { useForm } from "@tanstack/react-form";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { requiredValidator } from "../../lib/validators.js";
import { fieldError } from "../../lib/form.js";
import type { CourseDetail, Module, ModuleWithMaterials, User } from "../../../shared/schemas.js";
import { CourseFormModal } from "../../components/CourseFormModal.js";
import { ModuleCard } from "../../components/courses/ModuleCard.js";
import { EnrolledStudents } from "../../components/courses/EnrolledStudents.js";
import { Button } from "../../components/ui/Button.js";
import { ComboBox } from "../../components/ui/ComboBox.js";
import { Modal } from "../../components/ui/Modal.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Input } from "../../components/ui/Input.js";
import { serverRuntime } from "../../../server/runtime.js";
import { normalizeStudents, serializeCourseDetail } from "../../../shared/responseMappers.js";
import { toServerFunctionPayload } from "../../lib/serverFunctionPayload.js";
import { requireSession } from "../../lib/sessionGuards.server.js";
import { AuthenticatedRouteService } from "../../../server/services/authenticatedRouteService.js";
import { AdminRouteService } from "../../../server/services/adminRouteService.js";

type CourseDetailPageData = {
  course: CourseDetail & { modules: readonly ModuleWithMaterials[] };
  enrolledStudents: readonly User[];
  allStudents: readonly User[];
};

const getCourseDetailData = createServerFn({ method: "GET" })
  .validator(S.toStandardSchemaV1(S.Struct({ courseId: S.String })))
  .handler(({ data }) =>
    serverRuntime.runPromise(
      Effect.gen(function* () {
        const session = yield* requireSession(getCookie("session"));
        const course = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.courseById(session.session.id, data.courseId),
        );

        if (session.user.role !== "admin") {
          return toServerFunctionPayload({
            course: serializeCourseDetail(course),
            enrolledStudents: [],
            allStudents: [],
          }) satisfies CourseDetailPageData;
        }

        const [enrolledStudents, allStudents] = yield* Effect.all([
          AdminRouteService.use((adminRouteService) =>
            adminRouteService.listCourseStudents(session.session.id, data.courseId),
          ),
          AdminRouteService.use((adminRouteService) =>
            adminRouteService.listStudents(session.session.id),
          ),
        ]);

        return toServerFunctionPayload({
          course: serializeCourseDetail(course),
          enrolledStudents: normalizeStudents(enrolledStudents),
          allStudents: normalizeStudents(allStudents),
        }) satisfies CourseDetailPageData;
      }),
    ),
  );

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

export const Route = createFileRoute("/_authed/courses/$id")({
  head: () => ({ meta: [{ title: "Course Detail | DFG Portal" }] }),
  loader: ({ params }) => getCourseDetailData({ data: { courseId: params.id } }),
  component: CourseDetailPage,
  pendingComponent: () => <div>Loading...</div>,
});

function CourseDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const { course, enrolledStudents, allStudents } = Route.useLoaderData() as CourseDetailPageData;

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
      Effect.runPromise(api.admin.createModule({ params: { id }, payload })),
    onSuccess: (data) => {
      navigate({
        to: "/courses/$courseId/modules/$moduleId/edit",
        params: { courseId: id, moduleId: data.id },
      });
    },
  });

  const deleteModuleMutation = useMutation({
    mutationFn: (moduleId: string) =>
      Effect.runPromise(api.admin.deleteModule({ params: { id: moduleId } })),
    onSettled: () => void router.invalidate(),
  });

  const enrollStudentMutation = useMutation({
    mutationFn: (studentId: string) =>
      Effect.runPromise(
        api.admin.enrollStudent({
          params: { id: studentId },
          payload: { course_id: id },
        }),
      ),
    onSettled: () => void router.invalidate(),
  });

  const unenrollStudentMutation = useMutation({
    mutationFn: (studentId: string) =>
      Effect.runPromise(
        api.admin.unenrollStudent({
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
        <div className="mb-2 flex items-center gap-3">
          <Link
            to="/courses"
            className="text-sm text-muted no-underline transition-colors hover:text-primary dark:text-muted-dark dark:hover:text-primary-dark"
          >
            &larr; Courses
          </Link>
        </div>
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
