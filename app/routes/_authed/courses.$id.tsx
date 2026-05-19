import { useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import * as v from "valibot";
import { api } from "../../lib/api.js";
import { fieldError } from "../../lib/form.js";
import type { Module, ModuleWithMaterials, User } from "../../lib/types.js";
import { getCourseDetailPageData } from "../../lib/routeData.js";
import { CourseFormModal } from "../../components/CourseFormModal.js";
import { ModuleCard } from "../../components/courses/ModuleCard.js";
import { EnrolledStudents } from "../../components/courses/EnrolledStudents.js";
import { Button } from "../../components/ui/Button.js";
import { Select } from "../../components/ui/Select.js";
import { Modal } from "../../components/ui/Modal.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Input } from "../../components/ui/Input.js";

const requiredValidator = {
  onChange: v.pipe(v.string(), v.minLength(1, "Required")),
};

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

export const Route = createFileRoute("/_authed/courses/$id")({
  head: () => ({ meta: [{ title: "Course Detail | DFG Portal" }] }),
  loader: ({ params: { id } }) => getCourseDetailPageData({ data: { id } }),
  component: CourseDetailPage,
  pendingComponent: () => <div>Loading...</div>,
});

function CourseDetailPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const navigate = useNavigate();
  const { course, enrolledStudents, allStudents, isAdmin } = Route.useLoaderData();

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

  // ---- Invalidation helper ----
  const invalidateCourse = () => {
    void router.invalidate();
  };

  // ---- Mutations ----
  const createModuleMutation = useMutation({
    mutationFn: async (payload: { title: string }) => {
      const { data, error } = await api.admin.courses({ id }).modules.post(payload);
      if (error) throw error;
      if ("error" in data) throw data.error;
      return data;
    },
    onSuccess: (data) => {
      // Navigate to the edit page for the new module
      navigate({
        to: "/courses/$courseId/modules/$moduleId/edit",
        params: { courseId: id, moduleId: data.id },
      });
    },
  });

  const deleteModuleMutation = useMutation({
    mutationFn: async (moduleId: string) => {
      const { data, error } = await api.admin.modules({ id: moduleId }).delete();
      if (error) throw error;
      if ("error" in data) throw data.error;
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const enrollStudentMutation = useMutation({
    mutationFn: async (studentId: string) => {
      const { data, error } = await api.admin
        .students({ id: studentId })
        .enroll.post({ course_id: id });
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to enroll student");
      }
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const unenrollStudentMutation = useMutation({
    mutationFn: async (studentId: string) => {
      const { data, error } = await api.admin
        .students({ id: studentId })
        .enroll({ courseId: id })
        .delete();
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to unenroll student");
      }
      return data;
    },
    onSettled: () => invalidateCourse(),
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
    <main className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[900px]">
      {/* ---- Back link + title ---- */}
      <div className="mb-8">
        <div className="gap-3 mb-2 flex items-center">
          <Link
            to="/courses"
            className="text-muted dark:text-muted-dark text-sm hover:text-primary dark:hover:text-primary-dark no-underline transition-colors"
          >
            &larr; Courses
          </Link>
        </div>
        <div className="gap-4 flex items-center">
          <h1 className="text-3xl font-bold tracking-tight">{course.title}</h1>
          {isAdmin ? (
            <Button
              variant="ghost"
              onClick={openEditCourse}
              data-testid="edit-course"
              className="text-xs px-3 py-1.5"
            >
              Edit Course
            </Button>
          ) : null}
        </div>
        <p className="text-muted dark:text-muted-dark mt-2">
          <span className="text-accent font-medium">{course.instrument}</span> &mdash;{" "}
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
          <p className="text-muted dark:text-muted-dark py-8 text-center">No modules yet.</p>
        )
      ) : (
        <div className="-mx-5 md:mx-0 gap-5 flex flex-col">
          {course.modules.map((mod) => (
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
          enrolledStudents={enrolledStudents ?? []}
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
            className="gap-4 flex flex-col"
          >
            <enrollForm.Field name="student_id" validators={requiredValidator}>
              {(field) => (
                <Select
                  id="enroll-student-select"
                  name="student_id"
                  label="Student"
                  options={enrollStudentOptions}
                  value={field.state.value}
                  onChange={(v) => field.handleChange(v)}
                  onBlur={() => field.handleBlur()}
                  error={fieldError(field.state.meta.errors)}
                />
              )}
            </enrollForm.Field>
            <div className="gap-3 mt-2 flex justify-end">
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
          onSuccess={invalidateCourse}
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
            className="gap-5 flex flex-col"
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
            <div className="gap-3 mt-2 flex justify-end">
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
