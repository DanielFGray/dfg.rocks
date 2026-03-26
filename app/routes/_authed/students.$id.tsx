import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { studentDetailQuery, adminCoursesQuery, libraryQuery } from "../../lib/queries.js";
import type { Course, Material, StudentDetail } from "../../lib/types.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Select } from "../../components/ui/Select.js";
import { Modal } from "../../components/ui/Modal.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

export const Route = createFileRoute("/_authed/students/$id")({
  head: () => ({ meta: [{ title: "Student Detail | DFG Portal" }] }),
  loader: async ({ context: { queryClient }, params: { id } }) => {
    await Promise.allSettled([
      queryClient.ensureQueryData(studentDetailQuery(id)),
      queryClient.ensureQueryData(adminCoursesQuery),
      queryClient.ensureQueryData(libraryQuery),
    ]);
  },
  component: StudentDetailPage,
  pendingComponent: () => <div>Loading...</div>,
});

function StudentDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();

  // ---- Data fetching ----
  const { data: student } = useSuspenseQuery(studentDetailQuery(id));
  const { data: allCourses } = useSuspenseQuery(adminCoursesQuery);
  const { data: allMaterials } = useSuspenseQuery(libraryQuery);

  const enrolledIds = new Set(student.enrolled_courses.map((c: { id: string }) => c.id));
  const assignedIds = new Set(student.assigned_materials.map((m: Material) => m.id));

  const availableCourses = (allCourses as Course[]).filter(
    (c) => !enrolledIds.has(c.id),
  );
  const availableMaterials = (allMaterials as Material[]).filter(
    (m) => !assignedIds.has(m.id),
  );

  // ---- Modal state ----
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [unenrollTarget, setUnenrollTarget] = useState<{ id: string; title: string } | null>(null);
  const [unassignTarget, setUnassignTarget] = useState<Material | null>(null);

  // ---- Invalidation helper ----
  const invalidateStudent = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "students", id] });
  };

  // ---- Mutations ----
  const enrollMutation = useMutation({
    mutationFn: async (courseId: string) => {
      const { data } = await api.admin.students({ id }).enroll.post({ course_id: courseId });
      return data;
    },
    onSettled: () => invalidateStudent(),
  });

  const unenrollMutation = useMutation({
    mutationFn: async (courseId: string) => {
      const { data } = await api.admin.students({ id }).enroll({ courseId }).delete();
      return data;
    },
    onSettled: () => invalidateStudent(),
  });

  const assignMutation = useMutation({
    mutationFn: async (materialId: string) => {
      const { data } = await api.admin.students({ id }).assign.post({ material_id: materialId });
      return data;
    },
    onSettled: () => invalidateStudent(),
  });

  const unassignMutation = useMutation({
    mutationFn: async (materialId: string) => {
      const { data } = await api.admin.students({ id }).assign({ materialId }).delete();
      return data;
    },
    onSettled: () => invalidateStudent(),
  });

  // ---- Enroll handlers ----
  const openEnroll = () => setEnrollModalOpen(true);
  const closeEnroll = () => setEnrollModalOpen(false);
  const handleEnroll = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const courseId = new FormData(e.currentTarget).get("course_id") as string;
    if (!courseId) return;
    enrollMutation.mutate(courseId, { onSuccess: () => closeEnroll() });
  };

  // ---- Unenroll handlers ----
  const openUnenroll = (c: { id: string; title: string }) => () => setUnenrollTarget(c);
  const cancelUnenroll = () => setUnenrollTarget(null);
  const confirmUnenroll = () => {
    if (!unenrollTarget) return;
    unenrollMutation.mutate(unenrollTarget.id, {
      onSuccess: () => setUnenrollTarget(null),
    });
  };

  // ---- Assign handlers ----
  const openAssign = () => setAssignModalOpen(true);
  const closeAssign = () => setAssignModalOpen(false);
  const handleAssign = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const materialId = new FormData(e.currentTarget).get("material_id") as string;
    if (!materialId) return;
    assignMutation.mutate(materialId, { onSuccess: () => closeAssign() });
  };

  // ---- Unassign handlers ----
  const openUnassign = (m: Material) => () => setUnassignTarget(m);
  const cancelUnassign = () => setUnassignTarget(null);
  const confirmUnassign = () => {
    if (!unassignTarget) return;
    unassignMutation.mutate(unassignTarget.id, {
      onSuccess: () => setUnassignTarget(null),
    });
  };

  const courseOptions = [
    { value: "", label: "Select a course..." },
    ...availableCourses.map((c) => ({
      value: c.id,
      label: `${c.title} (${c.instrument})`,
    })),
  ];

  const materialOptions = [
    { value: "", label: "Select a material..." },
    ...availableMaterials.map((m) => ({
      value: m.id,
      label: `${m.title} (${m.original_filename})`,
    })),
  ];

  return (
    <main data-pwid="student-detail" className="max-w-[900px] mx-auto px-5 md:px-8 pt-20 pb-16">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Link to="/students" className="text-muted text-sm hover:text-primary transition-colors no-underline">
            &larr; Students
          </Link>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{student.name}</h1>
        <p className="text-muted mt-1">
          @{student.username} &middot; {student.email}
        </p>
      </div>

      {/* Enrolled Courses */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-primary">Enrolled Courses</h2>
          {availableCourses.length > 0 ? (
            <Button variant="outline" onClick={openEnroll} data-pwid="enroll-student" className="text-xs px-3 py-1.5">
              + Enroll
            </Button>
          ) : null}
        </div>
        {student.enrolled_courses.length === 0 ? (
          <EmptyState
            message="Not enrolled in any courses."
            action={
              availableCourses.length > 0
                ? { label: "Enroll in Course", onClick: openEnroll }
                : undefined
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {(student.enrolled_courses as StudentDetail["enrolled_courses"]).map((c) => (
              <Card key={c.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <Link to="/courses/$id" params={{ id: c.id }} className="font-semibold text-primary no-underline hover:text-accent transition-colors">
                      {c.title}
                    </Link>
                    <span className="text-muted text-sm ml-3">{c.instrument}</span>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={openUnenroll(c)}
                    className="text-xs px-2 py-1 text-red-400 hover:text-red-300"
                  >
                    Unenroll
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Assigned Materials */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-primary">Assigned Materials</h2>
          {availableMaterials.length > 0 ? (
            <Button variant="outline" onClick={openAssign} data-pwid="assign-material" className="text-xs px-3 py-1.5">
              + Assign
            </Button>
          ) : null}
        </div>
        {student.assigned_materials.length === 0 ? (
          <EmptyState
            message="No materials assigned."
            action={
              availableMaterials.length > 0
                ? { label: "Assign Material", onClick: openAssign }
                : undefined
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {(student.assigned_materials as Material[]).map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg bg-card border border-white/[0.06] px-4 py-3 text-sm">
                <span className="text-primary font-medium flex-1">{m.title}</span>
                <span className="text-muted/60 text-xs">{m.original_filename}</span>
                <button
                  type="button"
                  onClick={openUnassign(m)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer ml-2"
                >
                  Unassign
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Enroll Modal */}
      <Modal open={enrollModalOpen} onClose={closeEnroll} title="Enroll in Course">
        <form onSubmit={handleEnroll} data-pwid="enroll-form" className="flex flex-col gap-4">
          <Select
            id="enroll-course"
            name="course_id"
            label="Course"
            options={courseOptions}
            required
          />
          <div className="flex justify-end gap-3 mt-2">
            <Button variant="ghost" onClick={closeEnroll}>Cancel</Button>
            <Button type="submit">Enroll</Button>
          </div>
        </form>
      </Modal>

      {/* Assign Modal */}
      <Modal open={assignModalOpen} onClose={closeAssign} title="Assign Material">
        <form onSubmit={handleAssign} data-pwid="assign-form" className="flex flex-col gap-4">
          <Select
            id="assign-material"
            name="material_id"
            label="Material"
            options={materialOptions}
            required
          />
          <div className="flex justify-end gap-3 mt-2">
            <Button variant="ghost" onClick={closeAssign}>Cancel</Button>
            <Button type="submit">Assign</Button>
          </div>
        </form>
      </Modal>

      {/* Unenroll Confirm */}
      <ConfirmDialog
        open={unenrollTarget !== null}
        title="Unenroll Student"
        message={
          unenrollTarget
            ? `Remove ${student.name} from "${unenrollTarget.title}"?`
            : ""
        }
        confirmLabel="Unenroll"
        variant="danger"
        onConfirm={confirmUnenroll}
        onCancel={cancelUnenroll}
      />

      {/* Unassign Confirm */}
      <ConfirmDialog
        open={unassignTarget !== null}
        title="Unassign Material"
        message={
          unassignTarget
            ? `Remove "${unassignTarget.title}" from ${student.name}?`
            : ""
        }
        confirmLabel="Unassign"
        variant="danger"
        onConfirm={confirmUnassign}
        onCancel={cancelUnassign}
      />
    </main>
  );
}
