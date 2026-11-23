import { Effect } from "effect";
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { api } from "../../lib/api.js";
import { requiredValidator } from "../../lib/validators.js";
import { fieldError } from "../../lib/form.js";
import type { AssignedMaterial, PersonFamily, UserRole } from "../../../shared/schemas.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { requireStaff } from "../../lib/adminRoute.js";
import { adminCoursesQuery, libraryQuery, personDetailQuery } from "../../lib/queries.js";
import { Select } from "../../components/ui/Select.js";
import { findNotationTrack, formatNotationTrackLabel } from "../../../shared/notationTracks.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { ComboBox } from "../../components/ui/ComboBox.js";
import { Modal } from "../../components/ui/Modal.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { StudentRecurringBilling } from "../../components/students/StudentRecurringBilling.js";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "student", label: "Student" },
  { value: "parent", label: "Parent" },
  { value: "teacher", label: "Teacher" },
  { value: "admin", label: "Admin" },
];

function roleLabel(role: UserRole): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

function familyRoleLabel(family: PersonFamily): string {
  const flags = [
    family.is_owner ? "Owner" : null,
    family.is_billing_contact ? "Billing contact" : null,
  ].filter((flag): flag is string => flag !== null);
  return flags.length > 0 ? flags.join(" · ") : "Member";
}

// Staff open this page. Each admin-only action on it calls an admin endpoint, so the page renders
// those actions for admins alone; a teacher reads the same data.
export const Route = createFileRoute("/_authed/people/$id")({
  beforeLoad: requireStaff,
  head: () => ({ meta: [{ title: "Person | DFG Portal" }] }),
  component: PersonPage,
  pendingComponent: () => <div>Loading...</div>,
});

function PersonPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const { user: viewer, isAdmin } = useAuth();
  const { data: person } = useSuspenseQuery(personDetailQuery(id));

  // Only admins reach the course and material lists, so the queries wait for admin.
  const { data: courses } = useQuery({ ...adminCoursesQuery, enabled: isAdmin });
  const { data: library } = useQuery({ ...libraryQuery, enabled: isAdmin });
  const allCourses = courses ?? [];
  const allMaterials = library ?? [];

  const enrolledIds = new Set(person.enrolled_courses.map((c) => c.id));
  const assignedIds = new Set(person.assigned_materials.map((m) => m.id));

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

  // The people list and this person's detail share the ["admin", "people"] prefix.
  const invalidatePerson = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "people"] });
  };

  const [roleError, setRoleError] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<UserRole | null>(null);
  const roleMutation = useMutation({
    mutationFn: (role: UserRole) =>
      Effect.runPromise(api.peopleAdmin.setUserRole({ params: { id }, payload: { role } })),
    onSuccess: () => {
      setRoleError(null);
      invalidatePerson();
    },
    onError: (err: unknown) => {
      setRoleError(err instanceof Error ? err.message : "Failed to change role");
    },
    onSettled: () => setPendingRole(null),
  });
  // An admin cannot change their own role; the server refuses it too.
  const canChangeRole = isAdmin && viewer?.id !== id;
  // Learner sections (courses, materials, recurring billing) apply to students only.
  const isLearner = person.role === "student";

  const enrollMutation = useMutation({
    mutationFn: (courseId: string) =>
      Effect.runPromise(
        api.coursesAdmin.enrollStudent({
          params: { id },
          payload: { course_id: courseId },
        }),
      ),
    onSettled: () => invalidatePerson(),
  });

  const unenrollMutation = useMutation({
    mutationFn: (courseId: string) =>
      Effect.runPromise(
        api.coursesAdmin.unenrollStudent({
          params: { id, courseId },
        }),
      ),
    onSettled: () => invalidatePerson(),
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
    onSettled: () => invalidatePerson(),
  });

  const unassignMutation = useMutation({
    mutationFn: (materialId: string) =>
      Effect.runPromise(
        api.materialsAdmin.unassignMaterial({
          params: { id, materialId },
        }),
      ),
    onSettled: () => invalidatePerson(),
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

  const displayName = person.name ?? person.username;

  return (
    <main data-testid="person-detail" className="mx-auto max-w-[900px] px-5 pt-20 pb-16 md:px-8">
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-3">
          <Link
            to="/people"
            className="text-sm text-muted no-underline transition-colors hover:text-primary"
          >
            &larr; People
          </Link>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{displayName}</h1>
        <p className="mt-1 text-muted">
          @{person.username}
          {person.email ? <> &middot; {person.email}</> : null}
        </p>
        {canChangeRole ? (
          <div className="mt-4 max-w-xs">
            <Select
              id="person-role"
              data-testid="person-role"
              name="role"
              label="Role"
              value={person.role}
              onChange={(role) => {
                if (role !== person.role) setPendingRole(role as UserRole);
              }}
              options={ROLE_OPTIONS}
              disabled={roleMutation.isPending}
              error={roleError ?? undefined}
            />
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">
            Role: <span className="font-medium capitalize">{person.role}</span>
          </p>
        )}
      </div>

      <section className="mb-10" data-testid="person-families">
        <h2 className="mb-4 text-xl font-semibold text-primary">Families</h2>
        {person.families.length === 0 ? (
          <EmptyState message="Not in a family." />
        ) : (
          <div className="flex flex-col gap-3">
            {person.families.map((family) => (
              <Card key={family.id}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-primary">
                    {family.name}
                  </span>
                  <span className="text-sm text-muted">
                    {familyRoleLabel(family)}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {person.lessons.length > 0 ? (
        <section className="mb-10" data-testid="person-lessons">
          <h2 className="mb-4 text-xl font-semibold text-primary">
            Lessons
          </h2>
          <div className="flex flex-col gap-2">
            {person.lessons.map((lesson) => (
              <div
                key={lesson.id}
                className="flex items-center gap-3 rounded-lg border border-overlay/6 bg-card px-4 py-3 text-sm"
              >
                <span className="flex-1 font-medium text-primary">
                  {lesson.scheduled_at.toLocaleString()}
                </span>
                <span className="text-xs text-muted/60">
                  {lesson.duration_minutes} min · {lesson.location_type} · {lesson.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {isLearner ? (
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-primary">
              Enrolled Courses
            </h2>
            {isAdmin && availableCourses.length > 0 ? (
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
          {person.enrolled_courses.length === 0 ? (
            <EmptyState
              message="Not enrolled in any courses."
              action={
                isAdmin && availableCourses.length > 0
                  ? { label: "Enroll in Course", onClick: openEnroll }
                  : undefined
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              {person.enrolled_courses.map((c) => (
                <Card key={c.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <Link
                        to="/courses/$id"
                        params={{ id: c.id }}
                        className="font-semibold text-primary no-underline transition-colors hover:text-accent"
                      >
                        {c.title}
                      </Link>
                      <span className="ml-3 text-sm text-muted">
                        {c.instrument}
                      </span>
                    </div>
                    {isAdmin ? (
                      <Button
                        variant="ghost"
                        onClick={openUnenroll(c)}
                        className="px-2 py-1 text-xs text-red-600 hover:text-red-300 dark:text-red-400"
                      >
                        Unenroll
                      </Button>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {isLearner ? (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-primary">
              Assigned Materials
            </h2>
            {isAdmin && availableMaterials.length > 0 ? (
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
          {person.assigned_materials.length === 0 ? (
            <EmptyState
              message="No materials assigned."
              action={
                isAdmin && availableMaterials.length > 0
                  ? { label: "Assign Material", onClick: openAssign }
                  : undefined
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {person.assigned_materials.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-lg border border-overlay/6 bg-card px-4 py-3 text-sm"
                >
                  <span className="flex-1 font-medium text-primary">
                    {m.title}
                  </span>
                  <span className="text-xs text-muted/60">
                    {m.original_filename}
                    {(() => {
                      const track = findNotationTrack(m.notation_tracks, m.assigned_track_index);
                      return track ? ` · ${formatNotationTrackLabel(track)}` : "";
                    })()}
                  </span>
                  {isAdmin ? (
                    <Button
                      variant="ghost"
                      onClick={openUnassign(m)}
                      className="ml-2 text-xs text-red-600 hover:text-red-300 dark:text-red-400"
                    >
                      Unassign
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {isLearner && isAdmin ? <StudentRecurringBilling studentId={id} /> : null}

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
            <div className="rounded-lg border border-overlay/6 bg-card px-4 py-3 text-sm text-muted">
              Assigned track:{" "}
              <span className="font-medium text-primary">
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
        message={unenrollTarget ? `Remove ${displayName} from "${unenrollTarget.title}"?` : ""}
        confirmLabel="Unenroll"
        variant="danger"
        onConfirm={confirmUnenroll}
        onCancel={cancelUnenroll}
      />

      <ConfirmDialog
        open={unassignTarget !== null}
        title="Unassign Material"
        message={unassignTarget ? `Remove "${unassignTarget.title}" from ${displayName}?` : ""}
        confirmLabel="Unassign"
        variant="danger"
        onConfirm={confirmUnassign}
        onCancel={cancelUnassign}
      />

      <ConfirmDialog
        open={pendingRole !== null}
        title="Change role"
        message={
          pendingRole
            ? `Change ${displayName} from ${roleLabel(person.role)} to ${roleLabel(pendingRole)}?`
            : ""
        }
        confirmLabel="Confirm"
        onConfirm={() => {
          if (pendingRole) roleMutation.mutate(pendingRole);
        }}
        onCancel={() => setPendingRole(null)}
      />
    </main>
  );
}
