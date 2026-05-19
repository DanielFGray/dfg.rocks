import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import * as v from "valibot";
import { api } from "../../lib/api.js";
import type { Material } from "../../lib/types.js";
import { findNotationTrack, formatNotationTrackLabel } from "../../../shared/notationTracks.js";
import { getStudentDetailPageData } from "../../lib/routeData.js";
import { fieldError } from "../../lib/form.js";
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
  loader: ({ params: { id } }) => getStudentDetailPageData({ data: { id } }),
  component: StudentDetailPage,
  pendingComponent: () => <div>Loading...</div>,
});

function StudentDetailPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { student, allCourses, allMaterials } = Route.useLoaderData();

  const enrolledIds = new Set(student.enrolled_courses.map((c: { id: string }) => c.id));
  const assignedIds = new Set(student.assigned_materials.map((m: Material) => m.id));

  const availableCourses = allCourses.filter((c) => !enrolledIds.has(c.id));
  const availableMaterials = allMaterials.filter((m) => !assignedIds.has(m.id));

  // ---- Modal state ----
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignMaterialId, setAssignMaterialId] = useState("");
  const [assignTrackIndex, setAssignTrackIndex] = useState("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [unenrollTarget, setUnenrollTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [unassignTarget, setUnassignTarget] = useState<Material | null>(null);

  // ---- Invalidation helper ----
  const invalidateStudent = () => void router.invalidate();

  // ---- Mutations ----
  const enrollMutation = useMutation({
    mutationFn: async (courseId: string) => {
      const { data, error } = await api.admin.students({ id }).enroll.post({ course_id: courseId });
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to enroll student");
      }
      return data;
    },
    onSettled: () => invalidateStudent(),
  });

  const unenrollMutation = useMutation({
    mutationFn: async (courseId: string) => {
      const { data, error } = await api.admin.students({ id }).enroll({ courseId }).delete();
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to unenroll student");
      }
      return data;
    },
    onSettled: () => invalidateStudent(),
  });

  const assignMutation = useMutation({
    mutationFn: async ({
      materialId,
      assignedTrackIndex,
    }: {
      materialId: string;
      assignedTrackIndex: number | null;
    }) => {
      const { data, error } = await api.admin.students({ id }).assign.post({
        material_id: materialId,
        assigned_track_index: assignedTrackIndex,
      });
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to assign material");
      }
      return data;
    },
    onSettled: () => invalidateStudent(),
  });

  const unassignMutation = useMutation({
    mutationFn: async (materialId: string) => {
      const { data, error } = await api.admin.students({ id }).assign({ materialId }).delete();
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to unassign material");
      }
      return data;
    },
    onSettled: () => invalidateStudent(),
  });

  // ---- Enroll handlers ----
  const openEnroll = () => setEnrollModalOpen(true);
  const closeEnroll = () => {
    setEnrollModalOpen(false);
    enrollForm.reset();
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
  const openAssign = () => {
    setAssignModalOpen(true);
    setAssignMaterialId("");
    setAssignTrackIndex("");
    setAssignError(null);
  };
  const closeAssign = () => {
    setAssignModalOpen(false);
    setAssignMaterialId("");
    setAssignTrackIndex("");
    setAssignError(null);
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
  const selectedAssignMaterial =
    availableMaterials.find((material) => material.id === assignMaterialId) ?? null;

  const requiredValidator = {
    onChange: v.pipe(v.string(), v.minLength(1, "Required")),
  };

  const enrollForm = useForm({
    defaultValues: {
      courseId: "",
    },
    onSubmit: async ({ value }) => {
      enrollMutation.mutate(value.courseId, {
        onSuccess: () => closeEnroll(),
      });
    },
  });

  return (
    <main data-testid="student-detail" className="px-5 pb-16 pt-20 md:px-8 mx-auto max-w-[900px]">
      {/* Header */}
      <div className="mb-8">
        <div className="mb-2 gap-3 flex items-center">
          <Link
            to="/students"
            className="text-sm text-muted hover:text-primary dark:text-muted-dark dark:hover:text-primary-dark no-underline transition-colors"
          >
            &larr; Students
          </Link>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{student.name}</h1>
        <p className="mt-1 text-muted dark:text-muted-dark">
          @{student.username} &middot; {student.email}
        </p>
      </div>

      {/* Enrolled Courses */}
      <section className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-primary dark:text-primary-dark">
            Enrolled Courses
          </h2>
          {availableCourses.length > 0 ? (
            <Button
              variant="outline"
              onClick={openEnroll}
              data-testid="enroll-student"
              className="px-3 py-1.5 text-xs"
            >
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
          <div className="gap-3 flex flex-col">
            {student.enrolled_courses.map((c) => (
              <Card key={c.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <Link
                      to="/courses/$id"
                      params={{ id: c.id }}
                      className="font-semibold text-primary hover:text-accent dark:text-primary-dark no-underline transition-colors"
                    >
                      {c.title}
                    </Link>
                    <span className="ml-3 text-sm text-muted dark:text-muted-dark">
                      {c.instrument}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={openUnenroll(c)}
                    className="px-2 py-1 text-xs text-red-600 hover:text-red-300 dark:text-red-400"
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
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-primary dark:text-primary-dark">
            Assigned Materials
          </h2>
          {availableMaterials.length > 0 ? (
            <Button
              variant="outline"
              onClick={openAssign}
              data-testid="assign-material"
              className="px-3 py-1.5 text-xs"
            >
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
          <div className="gap-2 flex flex-col">
            {student.assigned_materials.map((m) => (
              <div
                key={m.id}
                className="gap-3 rounded-lg border-overlay/6 bg-card px-4 py-3 text-sm dark:border-overlay-dark/6 dark:bg-card-dark flex items-center border"
              >
                <span className="font-medium text-primary dark:text-primary-dark flex-1">
                  {m.title}
                </span>
                <span className="text-xs text-muted/60 dark:text-muted-dark/60">
                  {m.original_filename}
                  {(() => {
                    const track = findNotationTrack(m.notation_tracks, m.assigned_track_index);
                    return track ? ` · ${formatNotationTrackLabel(track)}` : "";
                  })()}
                </span>
                <button
                  type="button"
                  onClick={openUnassign(m)}
                  className="ml-2 text-xs text-red-600 hover:text-red-300 dark:text-red-400 cursor-pointer transition-colors"
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enrollForm.handleSubmit();
          }}
          data-testid="enroll-form"
          className="gap-4 flex flex-col"
        >
          <enrollForm.Field name="courseId" validators={requiredValidator}>
            {(field) => (
              <Select
                id="enroll-course"
                name="course_id"
                label="Course"
                options={courseOptions}
                required
                value={field.state.value}
                onChange={field.handleChange}
                error={fieldError(field.state.meta.errors)}
              />
            )}
          </enrollForm.Field>
          <div className="mt-2 gap-3 flex justify-end">
            <Button variant="ghost" onClick={closeEnroll}>
              Cancel
            </Button>
            <Button type="submit" disabled={enrollMutation.isPending}>
              {enrollMutation.isPending ? "Enrolling..." : "Enroll"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Assign Modal */}
      <Modal open={assignModalOpen} onClose={closeAssign} title="Assign Material">
        <form
          onSubmit={(e) => {
            e.preventDefault();

            if (!assignMaterialId) {
              setAssignError("Select a material.");
              return;
            }

            if (
              selectedAssignMaterial?.notation_tracks &&
              selectedAssignMaterial.notation_tracks.length > 1 &&
              !assignTrackIndex
            ) {
              setAssignError("Select a track for this notation assignment.");
              return;
            }

            setAssignError(null);
            assignMutation.mutate(
              {
                materialId: assignMaterialId,
                assignedTrackIndex:
                  assignTrackIndex === "" ? null : Number.parseInt(assignTrackIndex, 10),
              },
              {
                onSuccess: () => closeAssign(),
              },
            );
          }}
          data-testid="assign-form"
          className="gap-4 flex flex-col"
        >
          <Select
            id="assign-material"
            name="material_id"
            label="Material"
            options={materialOptions}
            required
            value={assignMaterialId}
            onChange={(value) => {
              setAssignMaterialId(value);
              setAssignError(null);

              const material =
                availableMaterials.find((candidate) => candidate.id === value) ?? null;
              const defaultTrackValue =
                material?.notation_tracks?.length === 1
                  ? String(material.notation_tracks[0]!.index)
                  : "";
              setAssignTrackIndex(defaultTrackValue);
            }}
          />
          {selectedAssignMaterial?.notation_tracks &&
          selectedAssignMaterial.notation_tracks.length > 1 ? (
            <Select
              id="assign-track"
              name="assigned_track_index"
              label="Assigned Track"
              options={[
                { value: "", label: "Select a track..." },
                ...selectedAssignMaterial.notation_tracks.map((track) => ({
                  value: String(track.index),
                  label: formatNotationTrackLabel(track),
                })),
              ]}
              required
              value={assignTrackIndex}
              onChange={(value) => {
                setAssignTrackIndex(value);
                setAssignError(null);
              }}
            />
          ) : selectedAssignMaterial?.notation_tracks &&
            selectedAssignMaterial.notation_tracks.length === 1 ? (
            <div className="rounded-lg border-overlay/6 bg-card px-4 py-3 text-sm text-muted dark:border-overlay-dark/6 dark:bg-card-dark dark:text-muted-dark border">
              Assigned track:{" "}
              <span className="font-medium text-primary dark:text-primary-dark">
                {formatNotationTrackLabel(selectedAssignMaterial.notation_tracks[0]!)}
              </span>
            </div>
          ) : null}
          {assignError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{assignError}</p>
          ) : null}
          <div className="mt-2 gap-3 flex justify-end">
            <Button variant="ghost" onClick={closeAssign}>
              Cancel
            </Button>
            <Button type="submit" disabled={assignMutation.isPending}>
              {assignMutation.isPending ? "Assigning..." : "Assign"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Unenroll Confirm */}
      <ConfirmDialog
        open={unenrollTarget !== null}
        title="Unenroll Student"
        message={unenrollTarget ? `Remove ${student.name} from "${unenrollTarget.title}"?` : ""}
        confirmLabel="Unenroll"
        variant="danger"
        onConfirm={confirmUnenroll}
        onCancel={cancelUnenroll}
      />

      {/* Unassign Confirm */}
      <ConfirmDialog
        open={unassignTarget !== null}
        title="Unassign Material"
        message={unassignTarget ? `Remove "${unassignTarget.title}" from ${student.name}?` : ""}
        confirmLabel="Unassign"
        variant="danger"
        onConfirm={confirmUnassign}
        onCancel={cancelUnassign}
      />
    </main>
  );
}
