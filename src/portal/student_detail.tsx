import * as Effect from "effect/Effect";
import { Atom, AtomRegistry, Suspense } from "fibrae";
import { NavigatorTag, Link } from "fibrae/router";
import { DfgApi, type Course, type Material, type StudentDetail } from "./api.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Select } from "../ui/select.js";
import { Modal } from "../ui/modal.js";
import { ConfirmDialog } from "../ui/confirm_dialog.js";
import { EmptyState } from "../ui/empty_state.js";

const enrollModalOpen = Atom.make(false);
const assignModalOpen = Atom.make(false);
const unenrollTarget = Atom.make<{ id: string; title: string } | null>(null);
const unassignTarget = Atom.make<Material | null>(null);

function StudentContent({
  id,
}: {
  id: string;
}) {
  return Effect.gen(function* () {
    const api = yield* DfgApi;
    const registry = yield* AtomRegistry.AtomRegistry;
    const student = yield* api.admin.studentDetail({ path: { id } });

    const refresh = Effect.gen(function* () {
      const navigator = yield* NavigatorTag;
      yield* navigator.go(`/students/${id}`);
    });

    // Fetch available courses and materials for pickers
    const allCourses = yield* api.admin.adminCourses({});
    const allMaterials = yield* api.authenticated.library({ urlParams: {} });

    const enrolledIds = new Set(student.enrolled_courses.map((c) => c.id));
    const assignedIds = new Set(student.assigned_materials.map((m) => m.id));

    const availableCourses = (allCourses as Course[]).filter(
      (c) => !enrolledIds.has(c.id),
    );
    const availableMaterials = (allMaterials as Material[]).filter(
      (m) => !assignedIds.has(m.id),
    );

    // Read atom state
    const showEnroll = registry.get(enrollModalOpen);
    const showAssign = registry.get(assignModalOpen);
    const unenrolling = registry.get(unenrollTarget);
    const unassigning = registry.get(unassignTarget);

    // Enroll handlers
    const openEnroll = () => registry.set(enrollModalOpen, true);
    const closeEnroll = () => registry.set(enrollModalOpen, false);
    const handleEnroll = (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const courseId = new FormData(form).get("course_id") as string;
      if (!courseId) return;
      return Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* api.admin.enrollStudent({ path: { id }, payload: { course_id: courseId } });
        registry.set(enrollModalOpen, false);
        yield* refresh;
      });
    };

    // Unenroll handlers
    const openUnenroll = (c: { id: string; title: string }) => () =>
      registry.set(unenrollTarget, c);
    const cancelUnenroll = () => registry.set(unenrollTarget, null);
    const confirmUnenroll = () => {
      const target = registry.get(unenrollTarget);
      if (!target) return;
      registry.set(unenrollTarget, null);
      return Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* api.admin.unenrollStudent({ path: { id, courseId: target.id } });
        yield* refresh;
      });
    };

    // Assign handlers
    const openAssign = () => registry.set(assignModalOpen, true);
    const closeAssign = () => registry.set(assignModalOpen, false);
    const handleAssign = (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const materialId = new FormData(form).get("material_id") as string;
      if (!materialId) return;
      return Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* api.admin.assignMaterial({ path: { id }, payload: { material_id: materialId } });
        registry.set(assignModalOpen, false);
        yield* refresh;
      });
    };

    // Unassign handlers
    const openUnassign = (m: Material) => () =>
      registry.set(unassignTarget, m);
    const cancelUnassign = () => registry.set(unassignTarget, null);
    const confirmUnassign = () => {
      const target = registry.get(unassignTarget);
      if (!target) return;
      registry.set(unassignTarget, null);
      return Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* api.admin.unassignMaterial({ path: { id, materialId: target.id } });
        yield* refresh;
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
      <div>
        {/* Header */}
        <div class="mb-8">
          <div class="flex items-center gap-3 mb-2">
            <Link href="/students" class="text-muted text-sm hover:text-primary transition-colors no-underline">
              &larr; Students
            </Link>
          </div>
          <h1 class="text-3xl font-bold tracking-tight">{student.name}</h1>
          <p class="text-muted mt-1">
            @{student.username} &middot; {student.email}
          </p>
        </div>

        {/* Enrolled Courses */}
        <section class="mb-10">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-semibold text-primary">Enrolled Courses</h2>
            {availableCourses.length > 0 ? (
              <Button variant="outline" onclick={openEnroll} data-cy="enroll-student" class="text-xs px-3 py-1.5">
                + Enroll
              </Button>
            ) : null}
          </div>
          {student.enrolled_courses.length === 0 ? (
            <EmptyState
              message="Not enrolled in any courses."
              action={
                availableCourses.length > 0
                  ? { label: "Enroll in Course", onclick: openEnroll }
                  : undefined
              }
            />
          ) : (
            <div class="flex flex-col gap-3">
              {(student.enrolled_courses as StudentDetail["enrolled_courses"][number][]).map((c) => (
                <Card>
                  <div class="flex items-center justify-between">
                    <div>
                      <Link href={`/courses/${c.id}`} class="font-semibold text-primary no-underline hover:text-accent transition-colors">
                        {c.title}
                      </Link>
                      <span class="text-muted text-sm ml-3">{c.instrument}</span>
                    </div>
                    <Button
                      variant="ghost"
                      onclick={openUnenroll(c)}
                      class="text-xs px-2 py-1 text-red-400 hover:text-red-300"
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
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-semibold text-primary">Assigned Materials</h2>
            {availableMaterials.length > 0 ? (
              <Button variant="outline" onclick={openAssign} data-cy="assign-material" class="text-xs px-3 py-1.5">
                + Assign
              </Button>
            ) : null}
          </div>
          {student.assigned_materials.length === 0 ? (
            <EmptyState
              message="No materials assigned."
              action={
                availableMaterials.length > 0
                  ? { label: "Assign Material", onclick: openAssign }
                  : undefined
              }
            />
          ) : (
            <div class="flex flex-col gap-2">
              {(student.assigned_materials as Material[]).map((m) => (
                <div class="flex items-center gap-3 rounded-lg bg-card border border-white/[0.06] px-4 py-3 text-sm">
                  <span class="text-primary font-medium flex-1">{m.title}</span>
                  <span class="text-muted/60 text-xs">{m.original_filename}</span>
                  <button
                    type="button"
                    onclick={openUnassign(m)}
                    class="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer ml-2"
                  >
                    Unassign
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Enroll Modal */}
        <Modal open={showEnroll} onclose={closeEnroll} title="Enroll in Course">
          <form onsubmit={handleEnroll} data-cy="enroll-form" class="flex flex-col gap-4">
            <Select
              id="enroll-course"
              name="course_id"
              label="Course"
              options={courseOptions}
              required
            />
            <div class="flex justify-end gap-3 mt-2">
              <Button variant="ghost" onclick={closeEnroll}>Cancel</Button>
              <Button type="submit">Enroll</Button>
            </div>
          </form>
        </Modal>

        {/* Assign Modal */}
        <Modal open={showAssign} onclose={closeAssign} title="Assign Material">
          <form onsubmit={handleAssign} data-cy="assign-form" class="flex flex-col gap-4">
            <Select
              id="assign-material"
              name="material_id"
              label="Material"
              options={materialOptions}
              required
            />
            <div class="flex justify-end gap-3 mt-2">
              <Button variant="ghost" onclick={closeAssign}>Cancel</Button>
              <Button type="submit">Assign</Button>
            </div>
          </form>
        </Modal>

        {/* Unenroll Confirm */}
        <ConfirmDialog
          open={unenrolling !== null}
          title="Unenroll Student"
          message={
            unenrolling
              ? `Remove ${student.name} from "${unenrolling.title}"?`
              : ""
          }
          confirmLabel="Unenroll"
          variant="danger"
          onconfirm={confirmUnenroll}
          oncancel={cancelUnenroll}
        />

        {/* Unassign Confirm */}
        <ConfirmDialog
          open={unassigning !== null}
          title="Unassign Material"
          message={
            unassigning
              ? `Remove "${unassigning.title}" from ${student.name}?`
              : ""
          }
          confirmLabel="Unassign"
          variant="danger"
          onconfirm={confirmUnassign}
          oncancel={cancelUnassign}
        />
      </div>
    );
  });
}

export const StudentDetailPage = ({ id }: { id: string }) => (
  <main data-cy="student-detail" class="max-w-[900px] mx-auto px-5 md:px-8 pt-20 pb-16">
    <Suspense fallback={<p class="text-muted">Loading student...</p>} threshold={50}>
      <StudentContent id={id} />
    </Suspense>
  </main>
);
