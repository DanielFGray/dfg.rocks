import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import * as v from "valibot";
import { api } from "../../lib/api.js";
import type {
  Material,
  Module,
  ModuleWithMaterials,
  User
} from "../../lib/types.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { courseDetailQuery, courseStudentsQuery, adminStudentsQuery, libraryQuery } from "../../lib/queries.js";
import { CourseFormModal } from "../../components/CourseFormModal.js";
import { ModuleCard } from "../../components/courses/ModuleCard.js";
import { EnrolledStudents } from "../../components/courses/EnrolledStudents.js";
import { AttachMaterialModal } from "../../components/courses/AttachMaterialModal.js";
import { Button } from "../../components/ui/Button.js";
import { Input } from "../../components/ui/Input.js";
import { Textarea } from "../../components/ui/Textarea.js";
import { Select } from "../../components/ui/Select.js";
import { Modal } from "../../components/ui/Modal.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

/* ---------------------------------------------------------------------------
 * Form Validators (Valibot — Standard Schema)
 * --------------------------------------------------------------------------- */

const requiredValidator = {
  onChange: v.pipe(v.string(), v.minLength(1, "Required")),
};

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

export const Route = createFileRoute("/_authed/courses/$id")({
  head: () => ({ meta: [{ title: "Course Detail | DFG Portal" }] }),
  loader: async ({ context: { queryClient, isAdmin }, params: { id } }) => {
    if (isAdmin) {
      await Promise.allSettled([
        queryClient.ensureQueryData(courseDetailQuery(id)),
        queryClient.ensureQueryData(courseStudentsQuery(id)),
        queryClient.ensureQueryData(adminStudentsQuery),
        queryClient.ensureQueryData(libraryQuery),
      ]);
    } else {
      await queryClient.ensureQueryData(courseDetailQuery(id));
    }
  },
  component: CourseDetailPage,
  pendingComponent: () => <div>Loading...</div>,
});

function CourseDetailPage() {
  const { id } = Route.useParams();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  // ---- Data fetching ----
  const { data: course } = useSuspenseQuery(courseDetailQuery(id));

  const { data: enrolledStudents } = useQuery({ ...courseStudentsQuery(id), enabled: isAdmin });
  const { data: allStudents } = useQuery({ ...adminStudentsQuery, enabled: isAdmin });
  const { data: allMaterials } = useQuery({ ...libraryQuery, enabled: isAdmin });

  const enrolledIds = new Set((enrolledStudents ?? []).map((s) => s.id));
  const availableStudents = (allStudents ?? []).filter((s) => !enrolledIds.has(s.id));

  const enrollStudentOptions = [
    { value: "", label: "Select a student..." },
    ...availableStudents.map((s) => ({
      value: s.id,
      label: `${s.name} (@${s.username})`,
    })),
  ];

  // ---- Modal state ----
  const [editCourseOpen, setEditCourseOpen] = useState(false);
  const [moduleFormOpen, setModuleFormOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<Module | null>(null);
  const [deleteModuleTarget, setDeleteModuleTarget] = useState<Module | null>(null);
  const [enrollStudentOpen, setEnrollStudentOpen] = useState(false);
  const [unenrollStudentTarget, setUnenrollStudentTarget] = useState<User | null>(null);
  const [attachMaterialModuleId, setAttachMaterialModuleId] = useState<string | null>(null);

  // ---- Invalidation helper ----
  const invalidateCourse = () => {
    queryClient.invalidateQueries({ queryKey: ["courses", id] });
    queryClient.invalidateQueries({ queryKey: ["admin", "courses", id, "students"] });
  };

  // ---- Mutations ----
  const createModuleMutation = useMutation({
    mutationFn: async (payload: { title: string; description?: string }) => {
      const { data } = await api.admin.courses({ id }).modules.post(payload);
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const updateModuleMutation = useMutation({
    mutationFn: async ({ moduleId, payload }: { moduleId: string; payload: { title: string; description?: string } }) => {
      const { data } = await api.admin.modules({ id: moduleId }).patch(payload);
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const deleteModuleMutation = useMutation({
    mutationFn: async (moduleId: string) => {
      const { data } = await api.admin.modules({ id: moduleId }).delete();
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const attachMaterialMutation = useMutation({
    mutationFn: async ({ moduleId, materialId }: { moduleId: string; materialId: string }) => {
      const { data } = await api.admin.modules({ id: moduleId }).materials.post({ material_id: materialId, sort_order: 0 });
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const detachMaterialMutation = useMutation({
    mutationFn: async ({ moduleId, materialId }: { moduleId: string; materialId: string }) => {
      const { data } = await api.admin.modules({ id: moduleId }).materials({ materialId }).delete();
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const enrollStudentMutation = useMutation({
    mutationFn: async (studentId: string) => {
      const { data } = await api.admin.students({ id: studentId }).enroll.post({ course_id: id });
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const unenrollStudentMutation = useMutation({
    mutationFn: async (studentId: string) => {
      const { data } = await api.admin.students({ id: studentId }).enroll({ courseId: id }).delete();
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  // ---- Forms (TanStack Form + Valibot) ----
  const moduleForm = useForm({
    defaultValues: { title: "", description: "" },
    onSubmit: async ({ value }) => {
      const payload = {
        title: value.title,
        description: value.description || undefined,
      };
      if (editingModule) {
        updateModuleMutation.mutate(
          { moduleId: editingModule.id, payload },
          { onSuccess: () => closeModuleForm() },
        );
      } else {
        createModuleMutation.mutate(payload, { onSuccess: () => closeModuleForm() });
      }
    },
  });

  const enrollForm = useForm({
    defaultValues: { student_id: "" },
    onSubmit: async ({ value }) => {
      if (!value.student_id) return;
      enrollStudentMutation.mutate(value.student_id, {
        onSuccess: () => setEnrollStudentOpen(false),
      });
    },
  });

  // ---- Edit Course handlers ----
  const openEditCourse = () => setEditCourseOpen(true);
  const closeEditCourse = () => setEditCourseOpen(false);

  // ---- Module form handlers ----
  const openAddModule = () => {
    setEditingModule(null);
    moduleForm.reset({ title: "", description: "" });
    setModuleFormOpen(true);
  };

  const closeModuleForm = () => {
    setModuleFormOpen(false);
    setEditingModule(null);
  };

  const openEditModule = (mod: Module) => {
    setEditingModule(mod);
    moduleForm.reset({ title: mod.title, description: mod.description ?? "" });
    setModuleFormOpen(true);
  };

  // ---- Delete module handlers ----
  const openDeleteModule = (mod: Module) => setDeleteModuleTarget(mod);
  const closeDeleteModule = () => setDeleteModuleTarget(null);

  const confirmDeleteModule = () => {
    if (!deleteModuleTarget) return;
    deleteModuleMutation.mutate(deleteModuleTarget.id, {
      onSuccess: () => setDeleteModuleTarget(null),
    });
  };

  // ---- Detach material handler ----
  const handleDetach = (moduleId: string, materialId: string) => {
    detachMaterialMutation.mutate({ moduleId, materialId });
  };

  // ---- Attach material handlers ----
  const closeAttachMaterial = () => setAttachMaterialModuleId(null);

  const handleAttachMaterial = (materialId: string) => {
    if (!attachMaterialModuleId) return;
    attachMaterialMutation.mutate(
      { moduleId: attachMaterialModuleId, materialId },
      { onSuccess: () => closeAttachMaterial() },
    );
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

  // ---- Computed values for attach material modal ----
  const attachingModule = attachMaterialModuleId
    ? course.modules.find((m: Module) => m.id === attachMaterialModuleId)
    : null;
  const attachedIds = new Set(
    attachingModule ? attachingModule.materials.map((m: Material) => m.id) : [],
  );
  const availableMaterials = allMaterials!.filter((m) => !attachedIds.has(m.id));

  return (
    <main className="max-w-[900px] mx-auto px-5 md:px-8 pt-20 pb-16">
      {/* ---- Back link + title ---- */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Link to="/dashboard" className="text-muted text-sm hover:text-primary transition-colors no-underline">
            &larr; Courses
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold tracking-tight">{course.title}</h1>
          {isAdmin ? (
            <Button
              variant="ghost"
              onClick={openEditCourse}
              data-pwid="edit-course"
              className="text-xs px-3 py-1.5"
            >
              Edit Course
            </Button>
          ) : null}
        </div>
        <p className="text-muted mt-2">
          <span className="text-accent font-medium">{course.instrument}</span>{" "}
          &mdash; {course.description}
        </p>
      </div>

      {/* ---- Admin: Add Module button ---- */}
      {isAdmin ? (
        <div className="mb-6 flex justify-end">
          <Button
            variant="outline"
            onClick={openAddModule}
            data-pwid="add-module"
          >
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
          <p className="text-muted py-8 text-center">No modules yet.</p>
        )
      ) : (
        <div className="flex flex-col gap-5">
          {(course.modules as ModuleWithMaterials[]).map((mod) => (
            <ModuleCard
              key={mod.id}
              mod={mod}
              isAdmin={isAdmin}
              onEdit={openEditModule}
              onDelete={openDeleteModule}
              onAttachMaterial={(moduleId) => setAttachMaterialModuleId(moduleId)}
              onDetachMaterial={handleDetach}
            />
          ))}
        </div>
      )}

      {/* ---- Enrolled Students (admin) ---- */}
      {isAdmin ? (
        <EnrolledStudents
          enrolledStudents={enrolledStudents as User[] ?? []}
          availableStudents={availableStudents}
          onEnroll={openEnrollStudent}
          onUnenroll={(s) => setUnenrollStudentTarget(s)}
        />
      ) : null}

      {/* ---- Enroll Student Modal ---- */}
      {isAdmin ? (
        <Modal open={enrollStudentOpen} onClose={closeEnrollStudent} title="Enroll Student">
          <form
            onSubmit={(e) => { e.preventDefault(); enrollForm.handleSubmit(); }}
            data-pwid="enroll-student-form"
            className="flex flex-col gap-4"
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
                  error={field.state.meta.errors[0] as string | undefined}
                />
              )}
            </enrollForm.Field>
            <div className="flex justify-end gap-3 mt-2">
              <Button variant="ghost" onClick={closeEnrollStudent}>Cancel</Button>
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
            unenrollStudentTarget
              ? `Remove ${unenrollStudentTarget.name} from this course?`
              : ""
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

      {/* ---- Module Form Modal (Add / Edit) ---- */}
      {isAdmin ? (
        <Modal
          open={moduleFormOpen}
          onClose={closeModuleForm}
          title={editingModule ? "Edit Module" : "Add Module"}
        >
          <form
            onSubmit={(e) => { e.preventDefault(); moduleForm.handleSubmit(); }}
            data-pwid="module-form"
            className="flex flex-col gap-5"
          >
            <moduleForm.Field name="title" validators={requiredValidator}>
              {(field) => (
                <Input
                  id="module-title"
                  name="title"
                  label="Title"
                  value={field.state.value}
                  onChange={(v) => field.handleChange(v)}
                  onBlur={() => field.handleBlur()}
                  error={field.state.meta.errors[0] as string | undefined}
                  placeholder="Module title"
                />
              )}
            </moduleForm.Field>
            <moduleForm.Field name="description">
              {(field) => (
                <Textarea
                  id="module-description"
                  name="description"
                  label="Description"
                  value={field.state.value}
                  onChange={(v) => field.handleChange(v)}
                  onBlur={() => field.handleBlur()}
                  placeholder="Optional description"
                />
              )}
            </moduleForm.Field>
            <div className="flex justify-end gap-3 mt-2">
              <Button variant="ghost" onClick={closeModuleForm}>
                Cancel
              </Button>
              <moduleForm.Subscribe selector={(s) => s.canSubmit}>
                {(canSubmit) => (
                  <Button type="submit" variant="primary" disabled={!canSubmit}>
                    {editingModule ? "Save" : "Create"}
                  </Button>
                )}
              </moduleForm.Subscribe>
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

      {/* ---- Attach Material Modal ---- */}
      {isAdmin ? (
        <AttachMaterialModal
          open={attachMaterialModuleId !== null}
          title={`Attach Material${attachingModule ? ` to ${attachingModule.title}` : ""}`}
          availableMaterials={availableMaterials}
          allMaterialsCount={(allMaterials as Material[]).length}
          onClose={closeAttachMaterial}
          onAttach={handleAttachMaterial}
        />
      ) : null}
    </main>
  );
}
