import { useState } from "react";
import { Effect } from "effect";
import * as S from "effect/Schema";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { api } from "../../lib/api.js";
import type { AssignedMaterial, Material, StudentDetail, User } from "../../../shared/schemas.js";
import * as SharedSchemas from "../../../shared/schemas.js";
import { formatNotationTrackLabel } from "../../../shared/notationTracks.js";
import { studentDetailQuery } from "../../lib/queries.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { getErrorMessage } from "../../lib/errors.js";
import {
  formatDuration,
  getAssignedTrackLabel,
} from "../../components/assignments/StudentAssignmentDetail.js";
import { categorize, categoryColor, categoryLabel } from "../../components/library/helpers.js";
import { runServerEffect } from "../../lib/serverEffect.js";
import { MaterialService } from "../../../server/services/materialService.js";
import { AdminRouteService } from "../../../server/services/adminRouteService.js";
import { SessionService } from "../../../server/services/sessionService.js";
import { getCookie } from "@tanstack/react-start/server";
import { serializeMaterial, normalizeStudents } from "../../../shared/responseMappers.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Modal } from "../../components/ui/Modal.js";
import { ComboBox } from "../../components/ui/ComboBox.js";
import { Main } from "../../components/ui/Container.js";

const getAssignmentsPageData = createServerFn({ method: "GET" }).handler(() =>
  runServerEffect(
    Effect.gen(function* () {
      const token = yield* Effect.sync(() => getCookie("session"));
      const session = yield* SessionService.use((sessionService) =>
        sessionService.validateSessionToken(token),
      );
      if (!session) throw new Error("Unauthorized");

      const effectiveStudentId =
        session.user.role === "parent" && session.session.active_student_id
          ? session.session.active_student_id
          : null;
      const filterStudentId = effectiveStudentId ?? undefined;

      const materialService = yield* MaterialService;

      if (session.user.role === "admin" || session.user.role === "teacher") {
        const adminSvc = yield* AdminRouteService;
        const [studentsResult, libraryResult] = yield* Effect.all([
          adminSvc.listStudents(session.session.id),
          materialService.library(session.session.id, { limit: 1000, offset: 0 }),
        ]);

        return {
          kind: "staff" as const,
          students: normalizeStudents(studentsResult),
          allMaterials: libraryResult.map((m) => ({
            id: m.id,
            title: m.title,
            original_filename: m.original_filename,
            mime_type: m.mime_type,
            file_size: m.file_size,
            is_global: m.is_global,
            notation_tracks: S.decodeUnknownSync(
              S.NullishOr(S.Array(SharedSchemas.MaterialNotationTrack)),
            )(m.notation_tracks),
          })),
        } as {
          kind: "staff";
          students: User[];
          allMaterials: Material[];
        };
      }

      const assignments = yield* materialService.assignments(session.session.id, filterStudentId);

      return {
        kind: "student" as const,
        materials: assignments.map(serializeMaterial),
      } as {
        kind: "student";
        materials: AssignedMaterial[];
      };
    }),
  ),
);

export const Route = createFileRoute("/_authed/assignments/")({
  loader: () => getAssignmentsPageData(),
  head: () => ({ meta: [{ title: "Assignments | DFG Portal" }] }),
  component: AssignmentsPage,
  pendingComponent: () => (
    <main className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 text-muted md:px-8 dark:text-muted-dark">
      Loading...
    </main>
  ),
});

function availableMaterialsForStudent(
  studentDetail: StudentDetail,
  allMaterials: readonly Material[],
) {
  const assignedIds = new Set(studentDetail.assigned_materials.map((m) => m.id));
  return allMaterials.filter((m) => !assignedIds.has(m.id));
}

function AssignmentsPage() {
  const { user } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "teacher";

  if (isStaff) {
    return <StaffAssignmentsPage />;
  }

  return <StudentAssignmentsPage />;
}

function StudentAssignmentsPage() {
  const data = Route.useLoaderData();
  if (data.kind !== "student") throw new Error("Expected student data");
  const { materials } = data;

  return (
    <Main data-testid="assignments">
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
        <div className="flex flex-col gap-3">
          {materials.map((material) => {
            const category = categorize(material.mime_type, material.original_filename);
            const assignedTrackLabel = getAssignedTrackLabel(material);

            return (
              <Link
                key={material.id}
                to="/assignments/$materialId"
                params={{ materialId: material.id }}
                className="no-underline"
                data-testid="assignment-open-link"
              >
                <Card data-testid="assignment-material-card" className="p-5 hover:border-accent/20">
                  <div className="flex items-start gap-3">
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wider uppercase ${categoryColor[category]}`}
                    >
                      {categoryLabel[category]}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <span className="block truncate text-sm font-medium text-primary dark:text-primary-dark">
                            {material.title}
                          </span>
                          <span className="block truncate text-xs text-muted/50 dark:text-muted-dark/50">
                            {material.original_filename}
                            {assignedTrackLabel ? ` · ${assignedTrackLabel}` : ""}
                          </span>
                        </div>

                        <span className="hidden shrink-0 text-sm font-medium text-accent md:inline">
                          Open
                        </span>
                      </div>
                    </div>

                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="mt-0.5 shrink-0 text-muted/40 dark:text-muted-dark/40"
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
    </Main>
  );
}

function StaffStudentCard({
  student,
  allMaterials,
  onAssign,
  onUnassign,
}: {
  student: User;
  allMaterials: readonly Material[];
  onAssign: (student: User) => void;
  onUnassign: (studentId: string, studentName: string, material: AssignedMaterial) => void;
}) {
  const { data: detail } = useSuspenseQuery(studentDetailQuery(student.id));
  const available = availableMaterialsForStudent(detail, allMaterials);

  return (
    <Card data-testid="assignment-student-card">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-primary dark:text-primary-dark">
              {detail.name}
            </h2>
            <p className="text-sm text-muted dark:text-muted-dark">
              @{detail.username}
              {detail.email ? ` · ${detail.email}` : ""}
            </p>
          </div>
          {available.length > 0 ? (
            <Button
              variant="outline"
              onClick={() => onAssign(student)}
              className="shrink-0 px-3 py-1.5 text-xs"
            >
              + Assign
            </Button>
          ) : null}
        </div>

        {detail.assigned_materials.length === 0 ? (
          <div className="rounded-lg border border-overlay/6 bg-card px-4 py-6 text-sm text-muted dark:border-overlay-dark/6 dark:bg-card-dark dark:text-muted-dark">
            {allMaterials.length === 0
              ? "No materials available to assign yet."
              : "No materials assigned."}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {detail.assigned_materials.map((material) => {
              const assignedTrackLabel = getAssignedTrackLabel(material);
              const category = categorize(material.mime_type, material.original_filename);

              return (
                <div
                  key={material.id}
                  className="flex items-center gap-3 rounded-lg border border-overlay/6 bg-card px-4 py-3 text-sm dark:border-overlay-dark/6 dark:bg-card-dark"
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-primary dark:text-primary-dark">
                      {material.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted/60 dark:text-muted-dark/60">
                      {material.original_filename}
                      {assignedTrackLabel ? ` · ${assignedTrackLabel}` : ""}
                      {category === "notation"
                        ? ` · Playback ${formatDuration(material.listened_seconds ?? 0)}`
                        : ""}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => onUnassign(detail.id, detail.name, material)}
                    className="ml-2 text-xs text-red-600 hover:text-red-300 dark:text-red-400"
                  >
                    Unassign
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

function StaffAssignmentsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const data = Route.useLoaderData();
  if (data.kind !== "staff") throw new Error("Expected staff data");
  const { students, allMaterials } = data;
  const [assignTarget, setAssignTarget] = useState<User | null>(null);
  const [assignMaterialId, setAssignMaterialId] = useState("");
  const [assignTrackIndex, setAssignTrackIndex] = useState("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [unassignTarget, setUnassignTarget] = useState<{
    studentId: string;
    studentName: string;
    materialId: string;
    materialTitle: string;
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
    }) =>
      Effect.runPromise(
        api.materials.assignStudentMaterial({
          params: { studentId },
          payload: {
            material_id: materialId,
            assigned_track_index: assignedTrackIndex,
          },
        }),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["assignments"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["admin", "students"] });
      void router.invalidate();
    },
  });

  const unassignMutation = useMutation({
    mutationFn: async ({ studentId, materialId }: { studentId: string; materialId: string }) =>
      Effect.runPromise(
        api.materials.unassignStudentMaterial({
          params: { studentId, materialId },
        }),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["assignments"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["admin", "students"] });
      void router.invalidate();
    },
  });

  const { data: assignTargetDetail } = useQuery({
    ...studentDetailQuery(assignTarget?.id ?? "__none__"),
    enabled: assignTarget !== null,
  });

  const closeAssign = () => {
    setAssignTarget(null);
    setAssignMaterialId("");
    setAssignTrackIndex("");
    setAssignError(null);
  };

  const assignableMaterials =
    assignTarget && assignTargetDetail
      ? availableMaterialsForStudent(assignTargetDetail, allMaterials)
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

  const handleUnassign = (studentId: string, studentName: string, material: AssignedMaterial) => {
    setUnassignTarget({
      studentId,
      studentName,
      materialId: material.id,
      materialTitle: material.title,
    });
  };

  return (
    <Main data-testid="assignments">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Assignments</h1>
        <p className="mt-2 text-muted dark:text-muted-dark">
          Assign materials to students and manage what each student currently has.
        </p>
      </div>

      {students.length === 0 ? (
        <EmptyState message="No students yet. Add students before assigning materials." />
      ) : (
        <div className="flex flex-col gap-4">
          {students.map((student) => (
            <StaffStudentCard
              key={student.id}
              student={student}
              allMaterials={allMaterials}
              onAssign={setAssignTarget}
              onUnassign={handleUnassign}
            />
          ))}
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
          className="flex flex-col gap-4"
        >
          <ComboBox
            id="staff-assign-material"
            name="material_id"
            label="Material"
            options={materialOptions.filter((o) => o.value !== "")}
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
            <ComboBox
              id="staff-assign-track"
              name="assigned_track_index"
              label="Assigned Track"
              options={assignTrackOptions.filter((o) => o.value !== "")}
              required
              value={assignTrackIndex}
              onChange={(value) => {
                setAssignTrackIndex(value);
                setAssignError(null);
              }}
              data-testid="staff-assign-track"
            />
          ) : selectedMaterial?.notation_tracks && selectedMaterial.notation_tracks.length === 1 ? (
            <div className="rounded-lg border border-overlay/6 bg-card px-4 py-3 text-sm text-muted dark:border-overlay-dark/6 dark:bg-card-dark dark:text-muted-dark">
              Assigned track:{" "}
              <span className="font-medium text-primary dark:text-primary-dark">
                {formatNotationTrackLabel(selectedMaterial.notation_tracks[0]!)}
              </span>
            </div>
          ) : null}
          {assignError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{assignError}</p>
          ) : null}
          {assignMutation.isError ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              {getErrorMessage(assignMutation.error, "Failed to assign material")}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
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
            ? `Remove "${unassignTarget.materialTitle}" from ${unassignTarget.studentName}?`
            : ""
        }
        confirmLabel="Unassign"
        variant="danger"
        onConfirm={() => {
          if (!unassignTarget) return;
          unassignMutation.mutate(
            {
              studentId: unassignTarget.studentId,
              materialId: unassignTarget.materialId,
            },
            {
              onSuccess: () => setUnassignTarget(null),
            },
          );
        }}
        onCancel={() => setUnassignTarget(null)}
      />
    </Main>
  );
}
