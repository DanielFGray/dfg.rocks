import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { Material, Module, User } from "../../lib/types.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Input } from "../../components/ui/Input.js";
import { Textarea } from "../../components/ui/Textarea.js";
import { Select } from "../../components/ui/Select.js";
import { Modal } from "../../components/ui/Modal.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

/* ---------------------------------------------------------------------------
 * Query Options
 * --------------------------------------------------------------------------- */

const courseDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["courses", id],
    queryFn: async () => {
      const { data, error } = await api.courses[id].get();
      if (error) throw error;
      return data;
    },
  });

const courseStudentsQuery = (id: string) =>
  queryOptions({
    queryKey: ["admin", "courses", id, "students"],
    queryFn: async () => {
      const { data, error } = await api.admin.courses[id].students.get();
      if (error) throw error;
      return data;
    },
  });

const adminStudentsQuery = queryOptions({
  queryKey: ["admin", "students"],
  queryFn: async () => {
    const { data, error } = await api.admin.students.get();
    if (error) throw error;
    return data;
  },
});

const libraryQuery = queryOptions({
  queryKey: ["library"],
  queryFn: async () => {
    const { data, error } = await api.library.get();
    if (error) throw error;
    return data;
  },
});

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

export const Route = createFileRoute("/_authed/courses/$id")({
  head: () => ({ meta: [{ title: "Course Detail | DFG Portal" }] }),
  loader: async ({ context: { queryClient }, params: { id } }) => {
    await Promise.allSettled([
      queryClient.ensureQueryData(courseDetailQuery(id)),
      queryClient.ensureQueryData(courseStudentsQuery(id)),
      queryClient.ensureQueryData(adminStudentsQuery),
      queryClient.ensureQueryData(libraryQuery),
    ]);
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

  const { data: enrolledStudents } = useSuspenseQuery(
    isAdmin
      ? courseStudentsQuery(id)
      : { queryKey: ["noop-course-students"], queryFn: () => Promise.resolve([] as User[]) },
  );
  const { data: allStudents } = useSuspenseQuery(
    isAdmin
      ? adminStudentsQuery
      : { queryKey: ["noop-all-students"], queryFn: () => Promise.resolve([] as User[]) },
  );
  const { data: allMaterials } = useSuspenseQuery(
    isAdmin
      ? libraryQuery
      : { queryKey: ["noop-library"], queryFn: () => Promise.resolve([] as Material[]) },
  );

  const enrolledIds = new Set((enrolledStudents as User[]).map((s) => s.id));
  const availableStudents = (allStudents as User[]).filter((s) => !enrolledIds.has(s.id));

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
  const updateCourseMutation = useMutation({
    mutationFn: async (payload: { title: string; instrument: string; description: string }) => {
      const { data, error } = await api.admin.courses[id].patch(payload);
      if (error) throw error;
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const createModuleMutation = useMutation({
    mutationFn: async (payload: { title: string; description?: string }) => {
      const { data, error } = await api.admin.courses[id].modules.post(payload);
      if (error) throw error;
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const updateModuleMutation = useMutation({
    mutationFn: async ({ moduleId, payload }: { moduleId: string; payload: { title: string; description?: string } }) => {
      const { data, error } = await api.admin.modules[moduleId].patch(payload);
      if (error) throw error;
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const deleteModuleMutation = useMutation({
    mutationFn: async (moduleId: string) => {
      const { data, error } = await api.admin.modules[moduleId].delete();
      if (error) throw error;
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const attachMaterialMutation = useMutation({
    mutationFn: async ({ moduleId, materialId }: { moduleId: string; materialId: string }) => {
      const { data, error } = await api.admin.modules[moduleId].materials.post({ material_id: materialId, sort_order: 0 });
      if (error) throw error;
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const detachMaterialMutation = useMutation({
    mutationFn: async ({ moduleId, materialId }: { moduleId: string; materialId: string }) => {
      const { data, error } = await api.admin.modules[moduleId].materials[materialId].delete();
      if (error) throw error;
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const enrollStudentMutation = useMutation({
    mutationFn: async (studentId: string) => {
      const { data, error } = await api.admin.students[studentId].enroll.post({ course_id: id });
      if (error) throw error;
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  const unenrollStudentMutation = useMutation({
    mutationFn: async (studentId: string) => {
      const { data, error } = await api.admin.students[studentId].enroll[id].delete();
      if (error) throw error;
      return data;
    },
    onSettled: () => invalidateCourse(),
  });

  // ---- Edit Course handlers ----
  const openEditCourse = () => setEditCourseOpen(true);
  const closeEditCourse = () => setEditCourseOpen(false);

  const handleEditCourseSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    updateCourseMutation.mutate(
      {
        title: data.get("title") as string,
        instrument: data.get("instrument") as string,
        description: data.get("description") as string,
      },
      { onSuccess: () => closeEditCourse() },
    );
  };

  // ---- Module form handlers ----
  const openAddModule = () => {
    setEditingModule(null);
    setModuleFormOpen(true);
  };

  const closeModuleForm = () => {
    setModuleFormOpen(false);
    setEditingModule(null);
  };

  const openEditModule = (mod: Module) => {
    setEditingModule(mod);
    setModuleFormOpen(true);
  };

  const handleModuleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const payload = {
      title: data.get("title") as string,
      description: (data.get("description") as string) || undefined,
    };

    if (editingModule) {
      updateModuleMutation.mutate(
        { moduleId: editingModule.id, payload },
        { onSuccess: () => closeModuleForm() },
      );
    } else {
      createModuleMutation.mutate(payload, {
        onSuccess: () => closeModuleForm(),
      });
    }
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
  const openAttachMaterial = (moduleId: string) => () => {
    setAttachMaterialModuleId(moduleId);
  };

  const closeAttachMaterial = () => setAttachMaterialModuleId(null);

  const handleAttachMaterial = (materialId: string) => {
    if (!attachMaterialModuleId) return;
    attachMaterialMutation.mutate(
      { moduleId: attachMaterialModuleId, materialId },
      { onSuccess: () => closeAttachMaterial() },
    );
  };

  // ---- Enroll/unenroll handlers ----
  const openEnrollStudent = () => setEnrollStudentOpen(true);
  const closeEnrollStudent = () => setEnrollStudentOpen(false);

  const handleEnrollStudent = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const studentId = new FormData(e.currentTarget).get("student_id") as string;
    if (!studentId) return;
    enrollStudentMutation.mutate(studentId, {
      onSuccess: () => closeEnrollStudent(),
    });
  };

  const openUnenrollStudent = (s: User) => () => setUnenrollStudentTarget(s);
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
  const availableMaterials = (allMaterials as Material[]).filter(
    (m) => !attachedIds.has(m.id),
  );

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
          {(course.modules as Module[]).map((mod) => (
            <Card key={mod.id}>
              <div className="flex items-start justify-between mb-1">
                <h2 className="text-lg font-semibold text-primary">
                  {mod.title}
                </h2>
                {isAdmin ? (
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <Button
                      variant="ghost"
                      onClick={() => openEditModule(mod)}
                      className="text-xs px-2 py-1"
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => openDeleteModule(mod)}
                      className="text-xs px-2 py-1 text-red-400 hover:text-red-300"
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
              </div>
              {mod.description ? (
                <p className="text-sm text-muted mb-4">{mod.description}</p>
              ) : null}
              {mod.materials.length === 0 ? (
                <p className="text-sm text-muted/60 italic">
                  No materials yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2 mt-3">
                  {mod.materials.map((mat: Material) => (
                    <li key={mat.id} className="flex items-center gap-3 rounded-lg bg-surface px-4 py-2.5 text-sm">
                      <span className="text-primary font-medium flex-1">
                        {mat.title}
                      </span>
                      <span className="text-muted/60 text-xs">
                        {mat.original_filename}
                      </span>
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => handleDetach(mod.id, mat.id)}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer ml-2"
                        >
                          Detach
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {isAdmin ? (
                <div className="mt-3 pt-3 border-t border-white/[0.06]">
                  <Button
                    variant="ghost"
                    className="text-xs px-2 py-1"
                    onClick={openAttachMaterial(mod.id)}
                  >
                    + Attach Material
                  </Button>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      {/* ---- Enrolled Students (admin) ---- */}
      {isAdmin ? (
        <section className="mt-10 pt-8 border-t border-white/[0.06]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-primary">Enrolled Students</h2>
            {availableStudents.length > 0 ? (
              <Button variant="outline" onClick={openEnrollStudent} data-pwid="enroll-student-course" className="text-xs px-3 py-1.5">
                + Enroll Student
              </Button>
            ) : null}
          </div>
          {(enrolledStudents as User[]).length === 0 ? (
            <EmptyState
              message="No students enrolled."
              action={
                availableStudents.length > 0
                  ? { label: "Enroll Student", onClick: openEnrollStudent }
                  : undefined
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {(enrolledStudents as User[]).map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg bg-card border border-white/[0.06] px-4 py-3 text-sm">
                  <div>
                    <Link to="/students/$id" params={{ id: s.id }} className="font-semibold text-primary no-underline hover:text-accent transition-colors">
                      {s.name}
                    </Link>
                    <span className="text-muted text-xs ml-3">@{s.username}</span>
                  </div>
                  <button
                    type="button"
                    onClick={openUnenrollStudent(s)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                  >
                    Unenroll
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* ---- Enroll Student Modal ---- */}
      {isAdmin ? (
        <Modal open={enrollStudentOpen} onClose={closeEnrollStudent} title="Enroll Student">
          <form onSubmit={handleEnrollStudent} data-pwid="enroll-student-form" className="flex flex-col gap-4">
            <Select
              id="enroll-student-select"
              name="student_id"
              label="Student"
              options={enrollStudentOptions}
              required
            />
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
        <Modal
          open={editCourseOpen}
          onClose={closeEditCourse}
          title="Edit Course"
        >
          <form
            onSubmit={handleEditCourseSubmit}
            data-pwid="edit-course-form"
            className="flex flex-col gap-5"
          >
            <Input
              id="edit-course-title"
              name="title"
              label="Title"
              required
              defaultValue={course.title}
              key={`title-${course.id}`}
              placeholder={course.title}
            />
            <Input
              id="edit-course-instrument"
              name="instrument"
              label="Instrument"
              required
              defaultValue={course.instrument}
              key={`inst-${course.id}`}
              placeholder={course.instrument}
            />
            <Textarea
              id="edit-course-description"
              name="description"
              label="Description"
              defaultValue={course.description}
              key={`desc-${course.id}`}
              placeholder={course.description}
            />
            <div className="flex justify-end gap-3 mt-2">
              <Button variant="ghost" onClick={closeEditCourse}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {/* ---- Module Form Modal (Add / Edit) ---- */}
      {isAdmin ? (
        <Modal
          open={moduleFormOpen}
          onClose={closeModuleForm}
          title={editingModule ? "Edit Module" : "Add Module"}
        >
          <form
            onSubmit={handleModuleFormSubmit}
            data-pwid="module-form"
            className="flex flex-col gap-5"
            key={editingModule?.id ?? "new-module"}
          >
            <Input
              id="module-title"
              name="title"
              label="Title"
              required
              defaultValue={editingModule?.title}
              placeholder={editingModule ? editingModule.title : "Module title"}
            />
            <Textarea
              id="module-description"
              name="description"
              label="Description"
              defaultValue={editingModule?.description}
              placeholder={
                editingModule?.description ?? "Optional description"
              }
            />
            <div className="flex justify-end gap-3 mt-2">
              <Button variant="ghost" onClick={closeModuleForm}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {editingModule ? "Save" : "Create"}
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

      {/* ---- Attach Material Modal ---- */}
      {isAdmin ? (
        <Modal
          open={attachMaterialModuleId !== null}
          onClose={closeAttachMaterial}
          title={`Attach Material${attachingModule ? ` to ${attachingModule.title}` : ""}`}
        >
          {availableMaterials.length === 0 ? (
            <p className="text-muted text-sm py-4 text-center">
              {(allMaterials as Material[]).length === 0
                ? "No materials in the library. Upload materials from the Library page first."
                : "All materials are already attached to this module."}
            </p>
          ) : (
            <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
              {availableMaterials.map((mat) => (
                <button
                  key={mat.id}
                  type="button"
                  onClick={() => handleAttachMaterial(mat.id)}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-surface px-4 py-3 text-sm text-left transition-colors hover:border-accent/40 hover:bg-accent/5 cursor-pointer"
                >
                  <span className="text-primary font-medium flex-1">
                    {mat.title}
                  </span>
                  <span className="text-muted/60 text-xs">
                    {mat.original_filename}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end mt-4">
            <Button variant="ghost" onClick={closeAttachMaterial}>
              Cancel
            </Button>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
