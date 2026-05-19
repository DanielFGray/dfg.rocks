import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type {
  AssignedMaterial,
  AssignmentProgress,
  AssignmentReview,
  Material,
} from "../../lib/types.js";
import { formatNotationTrackLabel } from "../../../shared/notationTracks.js";
import { getAssignmentsPageData } from "../../lib/routeData.js";
import {
  formatDate,
  formatDuration,
  getAssignedTrackLabel,
} from "../../components/assignments/StudentAssignmentDetail.js";
import { categorize, categoryColor, categoryLabel } from "../../components/library/helpers.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Modal } from "../../components/ui/Modal.js";
import { Select } from "../../components/ui/Select.js";

type StaffAssignmentsStudent = {
  id: string;
  username: string;
  name: string;
  email: string;
  assigned_materials: Array<
    AssignedMaterial & {
      listened_seconds: number;
    }
  >;
};

type ReviewMap = Record<string, AssignmentReview[]>;

export const Route = createFileRoute("/_authed/assignments/")({
  loader: () => getAssignmentsPageData(),
  head: () => ({ meta: [{ title: "Assignments | DFG Portal" }] }),
  component: AssignmentsPage,
  pendingComponent: () => (
    <main className="px-5 pb-16 pt-20 text-muted md:px-8 dark:text-muted-dark mx-auto max-w-[1100px]">
      Loading...
    </main>
  ),
});

function mapAssignmentReviews(reviews: AssignmentReview[]): ReviewMap {
  const grouped: ReviewMap = {};

  for (const review of reviews) {
    grouped[review.material_id] = [...(grouped[review.material_id] ?? []), review];
  }

  return grouped;
}

function availableMaterialsForStudent(
  student: StaffAssignmentsStudent,
  allMaterials: readonly Material[],
) {
  const assignedIds = new Set(student.assigned_materials.map((material) => material.id));
  return allMaterials.filter((material) => !assignedIds.has(material.id));
}

function AssignmentsPage() {
  const data = Route.useLoaderData();

  if (data.kind === "staff") {
    return <StaffAssignmentsPage students={data.students} allMaterials={data.allMaterials} />;
  }

  return (
    <StudentAssignmentsPage
      materials={data.materials}
      progress={data.progress}
      reviews={data.reviews}
    />
  );
}

function StudentAssignmentsPage({
  materials,
  progress: _progress,
  reviews,
}: {
  materials: AssignedMaterial[];
  progress: AssignmentProgress[];
  reviews: AssignmentReview[];
}) {
  const reviewsByMaterial = mapAssignmentReviews(reviews);

  return (
    <main data-testid="assignments" className="px-5 pb-16 pt-20 md:px-8 mx-auto max-w-[1100px]">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">My Assignments</h1>
        <p className="mt-2 text-muted dark:text-muted-dark">
          Playback time is tracked automatically for notation assignments while the player is
          running. Save 1-5 self-reviews over time as you improve.
        </p>
      </div>

      {materials.length === 0 ? (
        <EmptyState message="No assignments yet. Your teacher will assign materials here." />
      ) : (
        <div className="gap-3 flex flex-col">
          {materials.map((material) => {
            const category = categorize(material.mime_type, material.original_filename);
            const assignedTrackLabel = getAssignedTrackLabel(material);
            const materialReviews = reviewsByMaterial[material.id] ?? [];
            const latestReview = materialReviews[0] ?? null;
            const reviewCountLabel = `${materialReviews.length} self-review${materialReviews.length === 1 ? "" : "s"}`;

            return (
              <Link
                key={material.id}
                to="/assignments/$materialId"
                params={{ materialId: material.id }}
                className="no-underline"
                data-testid="assignment-open-link"
              >
                <Card data-testid="assignment-material-card" className="p-5 hover:border-accent/20">
                  <div className="gap-3 flex items-start">
                    <span
                      className={`rounded-md px-2 py-0.5 font-semibold tracking-wider shrink-0 text-[11px] uppercase ${categoryColor[category]}`}
                    >
                      {categoryLabel[category]}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="gap-4 flex items-start justify-between">
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-primary dark:text-primary-dark block truncate">
                            {material.title}
                          </span>
                          <span className="text-xs text-muted/50 dark:text-muted-dark/50 block truncate">
                            {material.original_filename}
                            {assignedTrackLabel ? ` · ${assignedTrackLabel}` : ""}
                          </span>
                        </div>

                        <span className="text-sm font-medium text-accent md:inline hidden shrink-0">
                          Open
                        </span>
                      </div>

                      {latestReview ? (
                        <div className="mt-4 gap-2 text-sm text-muted dark:text-muted-dark md:flex-row md:items-center md:justify-between flex flex-col">
                          <span className="text-xs text-muted/70 dark:text-muted-dark/70 md:text-right">
                            `Latest ${latestReview.stars}/5 ${formatDate(latestReview.created_at)} ·
                            ${reviewCountLabel}`
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="mt-0.5 text-muted/40 dark:text-muted-dark/40 shrink-0"
                    >
                      <polyline points="9 6 15 12 9 18" />
                    </svg>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}

function StaffAssignmentsPage({
  students,
  allMaterials,
}: {
  students: StaffAssignmentsStudent[];
  allMaterials: Material[];
}) {
  const router = useRouter();
  const [assignTarget, setAssignTarget] = useState<StaffAssignmentsStudent | null>(null);
  const [assignMaterialId, setAssignMaterialId] = useState("");
  const [assignTrackIndex, setAssignTrackIndex] = useState("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [unassignTarget, setUnassignTarget] = useState<{
    student: StaffAssignmentsStudent;
    material: Material;
  } | null>(null);

  const assignMutation = useMutation({
    mutationFn: async ({
      studentId,
      materialId,
      assignedTrackIndex,
    }: {
      studentId: string;
      materialId: string;
      assignedTrackIndex: number | null;
    }) => {
      const { data, error } = await api.assignments.students({ studentId }).assign.post({
        material_id: materialId,
        assigned_track_index: assignedTrackIndex,
      });
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to assign material");
      }
      return data;
    },
    onSettled: () => {
      void router.invalidate();
    },
  });

  const unassignMutation = useMutation({
    mutationFn: async ({ studentId, materialId }: { studentId: string; materialId: string }) => {
      const { data, error } = await api.assignments
        .students({ studentId })
        .assign({ materialId })
        .delete();
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to unassign material");
      }
      return data;
    },
    onSettled: () => {
      void router.invalidate();
    },
  });

  const closeAssign = () => {
    setAssignTarget(null);
    setAssignMaterialId("");
    setAssignTrackIndex("");
    setAssignError(null);
  };

  const assignableMaterials = assignTarget
    ? availableMaterialsForStudent(assignTarget, allMaterials)
    : [];
  const selectedMaterial =
    assignableMaterials.find((material) => material.id === assignMaterialId) ?? null;
  const selectedMaterialTrackOptions =
    selectedMaterial?.notation_tracks?.map((track) => ({
      value: String(track.index),
      label: formatNotationTrackLabel(track),
    })) ?? [];

  const materialOptions = [
    { value: "", label: "Select a material..." },
    ...assignableMaterials.map((material) => ({
      value: material.id,
      label: `${material.title} (${material.original_filename})`,
    })),
  ];

  const assignTrackOptions = [
    { value: "", label: "Select a track..." },
    ...selectedMaterialTrackOptions,
  ];

  return (
    <main data-testid="assignments" className="px-5 pb-16 pt-20 md:px-8 mx-auto max-w-[1100px]">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Assignments</h1>
        <p className="mt-2 text-muted dark:text-muted-dark">
          Assign materials to students and manage what each student currently has.
        </p>
      </div>

      {students.length === 0 ? (
        <EmptyState message="No students yet. Add students before assigning materials." />
      ) : (
        <div className="gap-4 flex flex-col">
          {students.map((student) => {
            const availableMaterials = availableMaterialsForStudent(student, allMaterials);

            return (
              <Card key={student.id} data-testid="assignment-student-card">
                <div className="gap-4 flex flex-col">
                  <div className="gap-4 flex items-start justify-between">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold text-primary dark:text-primary-dark">
                        {student.name}
                      </h2>
                      <p className="text-sm text-muted dark:text-muted-dark">
                        @{student.username}
                        {student.email ? ` · ${student.email}` : ""}
                      </p>
                    </div>
                    {availableMaterials.length > 0 ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setAssignTarget(student);
                          setAssignMaterialId("");
                          setAssignTrackIndex("");
                          setAssignError(null);
                        }}
                        className="px-3 py-1.5 text-xs shrink-0"
                      >
                        + Assign
                      </Button>
                    ) : null}
                  </div>

                  {student.assigned_materials.length === 0 ? (
                    <div className="rounded-lg border-overlay/6 bg-card px-4 py-6 text-sm text-muted dark:border-overlay-dark/6 dark:bg-card-dark dark:text-muted-dark border">
                      {allMaterials.length === 0
                        ? "No materials available to assign yet."
                        : "No materials assigned."}
                    </div>
                  ) : (
                    <div className="gap-2 flex flex-col">
                      {student.assigned_materials.map((material) => {
                        const category = categorize(material.mime_type, material.original_filename);
                        const assignedTrackLabel = getAssignedTrackLabel(material);

                        return (
                          <div
                            key={material.id}
                            className="gap-3 rounded-lg border-overlay/6 bg-card px-4 py-3 text-sm dark:border-overlay-dark/6 dark:bg-card-dark flex items-center border"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="font-medium text-primary dark:text-primary-dark block truncate">
                                {material.title}
                              </span>
                              <span className="mt-0.5 text-xs text-muted/60 dark:text-muted-dark/60 block truncate">
                                {material.original_filename}
                                {assignedTrackLabel ? ` · ${assignedTrackLabel}` : ""}
                                {category === "notation"
                                  ? ` · Playback ${formatDuration(material.listened_seconds)}`
                                  : ""}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setUnassignTarget({ student, material })}
                              className="ml-2 text-xs text-red-600 hover:text-red-300 dark:text-red-400 cursor-pointer transition-colors"
                            >
                              Unassign
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={assignTarget !== null}
        onClose={closeAssign}
        title={assignTarget ? `Assign Material to ${assignTarget.name}` : "Assign Material"}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();

            if (!assignTarget) {
              setAssignError("Choose a student before assigning.");
              return;
            }

            if (!assignMaterialId) {
              setAssignError("Select a material.");
              return;
            }

            if (
              selectedMaterial?.notation_tracks &&
              selectedMaterial.notation_tracks.length > 1 &&
              !assignTrackIndex
            ) {
              setAssignError("Select a track for this notation assignment.");
              return;
            }

            setAssignError(null);
            assignMutation.mutate(
              {
                studentId: assignTarget.id,
                materialId: assignMaterialId,
                assignedTrackIndex:
                  assignTrackIndex === "" ? null : Number.parseInt(assignTrackIndex, 10),
              },
              {
                onSuccess: () => closeAssign(),
              },
            );
          }}
          data-testid="staff-assign-form"
          className="gap-4 flex flex-col"
        >
          <Select
            id="staff-assign-material"
            name="material_id"
            label="Material"
            options={materialOptions}
            required
            value={assignMaterialId}
            onChange={(value) => {
              setAssignMaterialId(value);
              setAssignError(null);

              const material =
                assignableMaterials.find((candidate) => candidate.id === value) ?? null;
              const defaultTrackValue =
                material?.notation_tracks?.length === 1
                  ? String(material.notation_tracks[0]!.index)
                  : "";

              setAssignTrackIndex(defaultTrackValue);
            }}
            data-testid="staff-assign-material"
          />
          {selectedMaterial?.notation_tracks && selectedMaterial.notation_tracks.length > 1 ? (
            <Select
              id="staff-assign-track"
              name="assigned_track_index"
              label="Assigned Track"
              options={assignTrackOptions}
              required
              value={assignTrackIndex}
              onChange={(value) => {
                setAssignTrackIndex(value);
                setAssignError(null);
              }}
              data-testid="staff-assign-track"
            />
          ) : selectedMaterial?.notation_tracks && selectedMaterial.notation_tracks.length === 1 ? (
            <div className="rounded-lg border-overlay/6 bg-card px-4 py-3 text-sm text-muted dark:border-overlay-dark/6 dark:bg-card-dark dark:text-muted-dark border">
              Assigned track:{" "}
              <span className="font-medium text-primary dark:text-primary-dark">
                {formatNotationTrackLabel(selectedMaterial.notation_tracks[0]!)}
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
            <Button
              type="submit"
              disabled={
                assignMutation.isPending ||
                assignTarget === null ||
                assignableMaterials.length === 0
              }
            >
              {assignMutation.isPending ? "Assigning..." : "Assign"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={unassignTarget !== null}
        title="Unassign Material"
        message={
          unassignTarget
            ? `Remove "${unassignTarget.material.title}" from ${unassignTarget.student.name}?`
            : ""
        }
        confirmLabel="Unassign"
        variant="danger"
        onConfirm={() => {
          if (!unassignTarget) return;
          unassignMutation.mutate(
            {
              studentId: unassignTarget.student.id,
              materialId: unassignTarget.material.id,
            },
            {
              onSuccess: () => setUnassignTarget(null),
            },
          );
        }}
        onCancel={() => setUnassignTarget(null)}
      />
    </main>
  );
}
