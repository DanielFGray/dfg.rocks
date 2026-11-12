import { Effect } from "effect";
import { withAuthContext } from "../../../server/requestDatabase.js";
import * as S from "effect/Schema";
import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { useForm } from "@tanstack/react-form";
import { api } from "../../lib/api.js";
import { requiredValidator } from "../../lib/validators.js";
import { fieldError } from "../../lib/form.js";
import type { AssignedMaterial, Course, Material, StudentDetail } from "../../../shared/schemas.js";
import { findNotationTrack, formatNotationTrackLabel } from "../../../shared/notationTracks.js";
import { runServerEffect } from "../../lib/serverEffect.js";
import { Students } from "../../../server/services/students.js";
import { Materials } from "../../../server/services/materials.js";
import { Courses } from "../../../server/services/courses.js";
import {
  serializeCourse,
  serializeLibraryMaterial,
  serializeStudentDetail,
} from "../../../shared/responseMappers.js";
import { Sessions } from "../../../server/services/sessions.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { ComboBox } from "../../components/ui/ComboBox.js";
import { Modal } from "../../components/ui/Modal.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { StudentRecurringBilling } from "../../components/students/StudentRecurringBilling.js";

type StudentDetailPageData = {
  student: StudentDetail;
  allCourses: Course[];
  allMaterials: Material[];
};

const getStudentDetailPageData = createServerFn({ method: "GET" })
  .validator(S.toStandardSchemaV1(S.Struct({ studentId: S.String })))
  .handler(({ data }) =>
    runServerEffect(
      Effect.gen(function* () {
        const session = yield* Sessions.use((sessions) =>
          sessions.requireAdminSession(getCookie("session")),
        );
        const [student, allCourses, allMaterials] = yield* Effect.all([
          Students.use((studentService) => studentService.getStudent(data.studentId)),
          Courses.use((courseService) => courseService.listCourses()),
          Materials.use((materialService) =>
            materialService.library({
              limit: 1000,
              offset: 0,
            }),
          ),
        ]).pipe(withAuthContext(session.session.id));
        return {
          student: serializeStudentDetail(student),
          allCourses: allCourses.map(serializeCourse),
          allMaterials: allMaterials.map(serializeLibraryMaterial),
        } satisfies StudentDetailPageData;
      }),
    ),
  );

export const Route = createFileRoute("/_authed/students/$id")({
  head: () => ({ meta: [{ title: "Student Detail | DFG Portal" }] }),
  loader: ({ params }) => getStudentDetailPageData({ data: { studentId: params.id } }),
  component: StudentDetailPage,
  pendingComponent: () => <div>Loading...</div>,
});

function StudentDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { student, allCourses, allMaterials } = Route.useLoaderData();

  const enrolledIds = new Set(student.enrolled_courses.map((c) => c.id));
  const assignedIds = new Set(student.assigned_materials.map((m) => m.id));

  const availableCourses = allCourses.filter((c) => !enrolledIds.has(c.id));
  const availableMaterials = allMaterials.filter((m) => !assignedIds.has(m.id));

  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignMaterialId, setAssignMaterialId] = useState("");
  const [assignTrackIndex, setAssignTrackIndex] = useState("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [unenrollTarget, setUnenrollTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [unassignTarget, setUnassignTarget] = useState<AssignedMaterial | null>(null);

  const invalidateStudent = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "students", id] });
    void router.invalidate();
  };

  const enrollMutation = useMutation({
    mutationFn: (courseId: string) =>
      Effect.runPromise(
        api.coursesAdmin.enrollStudent({
          params: { id },
          payload: { course_id: courseId },
        }),
      ),
    onSettled: () => invalidateStudent(),
  });

  const unenrollMutation = useMutation({
    mutationFn: (courseId: string) =>
      Effect.runPromise(
        api.coursesAdmin.unenrollStudent({
          params: { id, courseId },
        }),
      ),
    onSettled: () => invalidateStudent(),
  });

  const assignMutation = useMutation({
    mutationFn: ({
      materialId,
      assignedTrackIndex,
    }: {
      materialId: string;
      assignedTrackIndex: number | null;
    }) =>
      Effect.runPromise(
        api.materialsAdmin.assignMaterial({
          params: { id },
          payload: {
            material_id: materialId,
            assigned_track_index: assignedTrackIndex,
          },
        }),
      ),
    onSettled: () => invalidateStudent(),
  });

  const unassignMutation = useMutation({
    mutationFn: (materialId: string) =>
      Effect.runPromise(
        api.materialsAdmin.unassignMaterial({
          params: { id, materialId },
        }),
      ),
    onSettled: () => invalidateStudent(),
  });

  const openEnroll = () => setEnrollModalOpen(true);
  const closeEnroll = () => {
    setEnrollModalOpen(false);
    enrollForm.reset();
  };

  const openUnenroll = (c: { id: string; title: string }) => () => setUnenrollTarget(c);
  const cancelUnenroll = () => setUnenrollTarget(null);
  const confirmUnenroll = () => {
    if (!unenrollTarget) return;
    unenrollMutation.mutate(unenrollTarget.id, {
      onSuccess: () => setUnenrollTarget(null),
    });
  };

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

  const openUnassign = (m: AssignedMaterial) => () => setUnassignTarget(m);
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
    <main data-testid="student-detail" className="mx-auto max-w-[900px] px-5 pt-20 pb-16 md:px-8">
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-3">
          <Link
            to="/students"
            className="text-sm text-muted no-underline transition-colors hover:text-primary dark:text-muted-dark dark:hover:text-primary-dark"
          >
            &larr; Students
          </Link>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{student.name}</h1>
        <p className="mt-1 text-muted dark:text-muted-dark">
          @{student.username} &middot; {student.email}
        </p>
      </div>

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
          <div className="flex flex-col gap-3">
            {student.enrolled_courses.map((c) => (
              <Card key={c.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <Link
                      to="/courses/$id"
                      params={{ id: c.id }}
                      className="font-semibold text-primary no-underline transition-colors hover:text-accent dark:text-primary-dark"
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
          <div className="flex flex-col gap-2">
            {student.assigned_materials.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-lg border border-overlay/6 bg-card px-4 py-3 text-sm dark:border-overlay-dark/6 dark:bg-card-dark"
              >
                <span className="flex-1 font-medium text-primary dark:text-primary-dark">
                  {m.title}
                </span>
                <span className="text-xs text-muted/60 dark:text-muted-dark/60">
                  {m.original_filename}
                  {(() => {
                    const track = findNotationTrack(m.notation_tracks, m.assigned_track_index);
                    return track ? ` · ${formatNotationTrackLabel(track)}` : "";
                  })()}
                </span>
                <Button
                  variant="ghost"
                  onClick={openUnassign(m)}
                  className="ml-2 text-xs text-red-600 hover:text-red-300 dark:text-red-400"
                >
                  Unassign
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <StudentRecurringBilling studentId={id} />

      <Modal open={enrollModalOpen} onClose={closeEnroll} title="Enroll in Course">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enrollForm.handleSubmit();
          }}
          data-testid="enroll-form"
          className="flex flex-col gap-4"
        >
          <enrollForm.Field name="courseId" validators={requiredValidator}>
            {(field) => (
              <ComboBox
                id="enroll-course"
                name="course_id"
                label="Course"
                options={courseOptions.filter((o) => o.value !== "")}
                required
                value={field.state.value}
                onChange={field.handleChange}
                error={fieldError(field.state.meta.errors)}
              />
            )}
          </enrollForm.Field>
          <div className="mt-2 flex justify-end gap-3">
            <Button variant="ghost" onClick={closeEnroll}>
              Cancel
            </Button>
            <Button type="submit" disabled={enrollMutation.isPending}>
              {enrollMutation.isPending ? "Enrolling..." : "Enroll"}
            </Button>
          </div>
        </form>
      </Modal>

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
          className="flex flex-col gap-4"
        >
          <ComboBox
            id="assign-material"
            name="material_id"
            label="Material"
            options={materialOptions.filter((o) => o.value !== "")}
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
            <ComboBox
              id="assign-track"
              name="assigned_track_index"
              label="Assigned Track"
              options={selectedAssignMaterial.notation_tracks.map((track) => ({
                value: String(track.index),
                label: formatNotationTrackLabel(track),
              }))}
              required
              value={assignTrackIndex}
              onChange={(value) => {
                setAssignTrackIndex(value);
                setAssignError(null);
              }}
            />
          ) : selectedAssignMaterial?.notation_tracks &&
            selectedAssignMaterial.notation_tracks.length === 1 ? (
            <div className="rounded-lg border border-overlay/6 bg-card px-4 py-3 text-sm text-muted dark:border-overlay-dark/6 dark:bg-card-dark dark:text-muted-dark">
              Assigned track:{" "}
              <span className="font-medium text-primary dark:text-primary-dark">
                {formatNotationTrackLabel(selectedAssignMaterial.notation_tracks[0]!)}
              </span>
            </div>
          ) : null}
          {assignError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{assignError}</p>
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <Button variant="ghost" onClick={closeAssign}>
              Cancel
            </Button>
            <Button type="submit" disabled={assignMutation.isPending}>
              {assignMutation.isPending ? "Assigning..." : "Assign"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={unenrollTarget !== null}
        title="Unenroll Student"
        message={unenrollTarget ? `Remove ${student.name} from "${unenrollTarget.title}"?` : ""}
        confirmLabel="Unenroll"
        variant="danger"
        onConfirm={confirmUnenroll}
        onCancel={cancelUnenroll}
      />

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
