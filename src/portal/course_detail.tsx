import * as Effect from "effect/Effect";
import { Atom, AtomRegistry, Suspense } from "fibrae";
import { NavigatorTag, Link } from "fibrae/router";
import { DfgApi, type Material, type Module, type User } from "./api.js";
import { currentUser, isAdmin } from "./auth.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";
import { Select } from "../ui/select.js";
import { Modal } from "../ui/modal.js";
import { ConfirmDialog } from "../ui/confirm_dialog.js";
import { EmptyState } from "../ui/empty_state.js";

/* ---------------------------------------------------------------------------
 * Atoms for admin modal / dialog state
 * --------------------------------------------------------------------------- */

const editCourseOpen = Atom.make<boolean>(false);
const moduleFormOpen = Atom.make<boolean>(false);
const editingModule = Atom.make<Module | null>(null);
const deleteModuleTarget = Atom.make<Module | null>(null);
const enrollStudentOpen = Atom.make(false);
const unenrollStudentTarget = Atom.make<User | null>(null);
const attachMaterialModuleId = Atom.make<string | null>(null);

/* ---------------------------------------------------------------------------
 * CourseContent — the main Effect component
 * --------------------------------------------------------------------------- */

function CourseContent({
  id,
}: {
  id: string;
}) {
  return Effect.gen(function* () {
    const api = yield* DfgApi;
    const registry = yield* AtomRegistry.AtomRegistry;
    const course = yield* api.authenticated.courseDetail({ path: { id } });
    const user = registry.get(currentUser);
    const admin = isAdmin(user);

    /* -- helpers to refresh the page after mutations -- */
    const refresh = Effect.gen(function* () {
      const navigator = yield* NavigatorTag;
      yield* navigator.go(`/courses/${id}`);
    });

    /* -- Edit Course modal handlers -- */
    const openEditCourse = () => {
      registry.set(editCourseOpen, true);
    };

    const closeEditCourse = () => {
      registry.set(editCourseOpen, false);
    };

    const handleEditCourseSubmit = (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const data = new FormData(form);
      return Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* api.admin.updateCourse({ path: { id }, payload: {
          title: data.get("title") as string,
          instrument: data.get("instrument") as string,
          description: data.get("description") as string,
        } });
        registry.set(editCourseOpen, false);
        yield* refresh;
      });
    };

    /* -- Add Module handlers -- */
    const openAddModule = () => {
      registry.set(editingModule, null);
      registry.set(moduleFormOpen, true);
    };

    const closeModuleForm = () => {
      registry.set(moduleFormOpen, false);
      registry.set(editingModule, null);
    };

    /* -- Edit Module handlers -- */
    const openEditModule = (mod: Module) => {
      registry.set(editingModule, mod);
      registry.set(moduleFormOpen, true);
    };

    const handleModuleFormSubmit = (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const data = new FormData(form);
      const editing = registry.get(editingModule);
      return Effect.gen(function* () {
        const api = yield* DfgApi;
        if (editing) {
          yield* api.admin.updateModule({ path: { id: editing.id }, payload: {
            title: data.get("title") as string,
            description: (data.get("description") as string) || undefined,
          } });
        } else {
          yield* api.admin.createModule({ path: { courseId: id }, payload: {
            title: data.get("title") as string,
            description: (data.get("description") as string) || undefined,
          } });
        }
        registry.set(moduleFormOpen, false);
        registry.set(editingModule, null);
        yield* refresh;
      });
    };

    /* -- Delete Module handlers -- */
    const openDeleteModule = (mod: Module) => {
      registry.set(deleteModuleTarget, mod);
    };

    const closeDeleteModule = () => {
      registry.set(deleteModuleTarget, null);
    };

    const confirmDeleteModule = () => {
      const target = registry.get(deleteModuleTarget);
      if (!target) return;
      registry.set(deleteModuleTarget, null);
      return Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* api.admin.deleteModule({ path: { id: target.id } });
        yield* refresh;
      });
    };

    /* -- Detach Material handler -- */
    const handleDetach = (moduleId: string, materialId: string) => {
      return Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* api.admin.detachMaterial({ path: { moduleId, materialId } });
        yield* refresh;
      });
    };

    /* -- Attach Material handlers -- */
    const allMaterials: readonly Material[] = admin
      ? yield* api.authenticated.library({ urlParams: {} })
      : [];

    const openAttachMaterial = (moduleId: string) => () => {
      registry.set(attachMaterialModuleId, moduleId);
    };

    const closeAttachMaterial = () => {
      registry.set(attachMaterialModuleId, null);
    };

    const handleAttachMaterial = (materialId: string) => {
      const moduleId = registry.get(attachMaterialModuleId);
      if (!moduleId) return;
      registry.set(attachMaterialModuleId, null);
      return Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* api.admin.attachMaterial({ path: { id: moduleId }, payload: { material_id: materialId, sort_order: 0 } });
        yield* refresh;
      });
    };

    /* -- Enrolled students (admin only) -- */
    const enrolledStudents = admin ? yield* api.admin.courseStudents({ path: { id } }) : [];
    const allStudents = admin ? yield* api.admin.students({}) : [];
    const enrolledIds = new Set((enrolledStudents as User[]).map((s) => s.id));
    const availableStudents = (allStudents as User[]).filter(
      (s) => !enrolledIds.has(s.id),
    );

    const enrollStudentOptions = [
      { value: "", label: "Select a student..." },
      ...availableStudents.map((s) => ({
        value: s.id,
        label: `${s.name} (@${s.username})`,
      })),
    ];

    const openEnrollStudent = () => registry.set(enrollStudentOpen, true);
    const closeEnrollStudent = () => registry.set(enrollStudentOpen, false);
    const handleEnrollStudent = (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const studentId = new FormData(form).get("student_id") as string;
      if (!studentId) return;
      return Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* api.admin.enrollStudent({ path: { id: studentId }, payload: { course_id: id } });
        registry.set(enrollStudentOpen, false);
        yield* refresh;
      });
    };

    const openUnenrollStudent = (s: User) => () =>
      registry.set(unenrollStudentTarget, s);
    const cancelUnenrollStudent = () =>
      registry.set(unenrollStudentTarget, null);
    const confirmUnenrollStudent = () => {
      const target = registry.get(unenrollStudentTarget);
      if (!target) return;
      registry.set(unenrollStudentTarget, null);
      return Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* api.admin.unenrollStudent({ path: { id: target.id, courseId: id } });
        yield* refresh;
      });
    };

    /* -- Read atom values for modal state -- */
    const showEditCourse = registry.get(editCourseOpen);
    const showModuleForm = registry.get(moduleFormOpen);
    const editing = registry.get(editingModule);
    const delTarget = registry.get(deleteModuleTarget);
    const showEnrollStudent = registry.get(enrollStudentOpen);
    const unenrollingStudent = registry.get(unenrollStudentTarget);
    const attachingModuleId = registry.get(attachMaterialModuleId);

    /* -- Build list of materials not already attached to the target module -- */
    const attachingModule = attachingModuleId
      ? course.modules.find((m) => m.id === attachingModuleId)
      : null;
    const attachedIds = new Set(
      attachingModule ? attachingModule.materials.map((m) => m.id) : [],
    );
    const availableMaterials = (allMaterials as Material[]).filter(
      (m) => !attachedIds.has(m.id),
    );

    return (
      <div>
        {/* ---- Back link + title ---- */}
        <div class="mb-8">
          <div class="flex items-center gap-3 mb-2">
            <Link href="/dashboard" class="text-muted text-sm hover:text-primary transition-colors no-underline">
              &larr; Courses
            </Link>
          </div>
          <div class="flex items-center gap-4">
            <h1 class="text-3xl font-bold tracking-tight">{course.title}</h1>
            {admin ? (
              <Button
                variant="ghost"
                onclick={openEditCourse}
                data-cy="edit-course"
                class="text-xs px-3 py-1.5"
              >
                Edit Course
              </Button>
            ) : null}
          </div>
          <p class="text-muted mt-2">
            <span class="text-accent font-medium">{course.instrument}</span>{" "}
            &mdash; {course.description}
          </p>
        </div>

        {/* ---- Admin: Add Module button ---- */}
        {admin ? (
          <div class="mb-6 flex justify-end">
            <Button
              variant="outline"
              onclick={openAddModule}
              data-cy="add-module"
            >
              + Add Module
            </Button>
          </div>
        ) : null}

        {/* ---- Modules list ---- */}
        {course.modules.length === 0 ? (
          admin ? (
            <EmptyState
              message="No modules yet."
              action={{ label: "Add Module", onclick: openAddModule }}
            />
          ) : (
            <p class="text-muted py-8 text-center">No modules yet.</p>
          )
        ) : (
          <div class="flex flex-col gap-5">
            {course.modules.map((mod) => (
              <Card>
                <div class="flex items-start justify-between mb-1">
                  <h2 class="text-lg font-semibold text-primary">
                    {mod.title}
                  </h2>
                  {admin ? (
                    <div class="flex items-center gap-2 shrink-0 ml-3">
                      <Button
                        variant="ghost"
                        onclick={() => openEditModule(mod)}
                        class="text-xs px-2 py-1"
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        onclick={() => openDeleteModule(mod)}
                        class="text-xs px-2 py-1 text-red-400 hover:text-red-300"
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </div>
                {mod.description ? (
                  <p class="text-sm text-muted mb-4">{mod.description}</p>
                ) : null}
                {mod.materials.length === 0 ? (
                  <p class="text-sm text-muted/60 italic">
                    No materials yet.
                  </p>
                ) : (
                  <ul class="flex flex-col gap-2 mt-3">
                    {mod.materials.map((mat) => (
                      <li class="flex items-center gap-3 rounded-lg bg-surface px-4 py-2.5 text-sm">
                        <span class="text-primary font-medium flex-1">
                          {mat.title}
                        </span>
                        <span class="text-muted/60 text-xs">
                          {mat.original_filename}
                        </span>
                        {admin ? (
                          <button
                            type="button"
                            onclick={() => handleDetach(mod.id, mat.id)}
                            class="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer ml-2"
                          >
                            Detach
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {admin ? (
                  <div class="mt-3 pt-3 border-t border-white/[0.06]">
                    <Button
                      variant="ghost"
                      class="text-xs px-2 py-1"
                      onclick={openAttachMaterial(mod.id)}
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
        {admin ? (
          <section class="mt-10 pt-8 border-t border-white/[0.06]">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-xl font-semibold text-primary">Enrolled Students</h2>
              {availableStudents.length > 0 ? (
                <Button variant="outline" onclick={openEnrollStudent} data-cy="enroll-student-course" class="text-xs px-3 py-1.5">
                  + Enroll Student
                </Button>
              ) : null}
            </div>
            {(enrolledStudents as User[]).length === 0 ? (
              <EmptyState
                message="No students enrolled."
                action={
                  availableStudents.length > 0
                    ? { label: "Enroll Student", onclick: openEnrollStudent }
                    : undefined
                }
              />
            ) : (
              <div class="flex flex-col gap-2">
                {(enrolledStudents as User[]).map((s) => (
                  <div class="flex items-center justify-between rounded-lg bg-card border border-white/[0.06] px-4 py-3 text-sm">
                    <div>
                      <Link href={`/students/${s.id}`} class="font-semibold text-primary no-underline hover:text-accent transition-colors">
                        {s.name}
                      </Link>
                      <span class="text-muted text-xs ml-3">@{s.username}</span>
                    </div>
                    <button
                      type="button"
                      onclick={openUnenrollStudent(s)}
                      class="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer"
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
        {admin ? (
          <Modal open={showEnrollStudent} onclose={closeEnrollStudent} title="Enroll Student">
            <form onsubmit={handleEnrollStudent} data-cy="enroll-student-form" class="flex flex-col gap-4">
              <Select
                id="enroll-student-select"
                name="student_id"
                label="Student"
                options={enrollStudentOptions}
                required
              />
              <div class="flex justify-end gap-3 mt-2">
                <Button variant="ghost" onclick={closeEnrollStudent}>Cancel</Button>
                <Button type="submit">Enroll</Button>
              </div>
            </form>
          </Modal>
        ) : null}

        {/* ---- Unenroll Student Confirm ---- */}
        {admin ? (
          <ConfirmDialog
            open={unenrollingStudent !== null}
            title="Unenroll Student"
            message={
              unenrollingStudent
                ? `Remove ${unenrollingStudent.name} from this course?`
                : ""
            }
            confirmLabel="Unenroll"
            variant="danger"
            onconfirm={confirmUnenrollStudent}
            oncancel={cancelUnenrollStudent}
          />
        ) : null}

        {/* ---- Edit Course Modal ---- */}
        {admin ? (
          <Modal
            open={showEditCourse}
            onclose={closeEditCourse}
            title="Edit Course"
          >
            <form
              onsubmit={handleEditCourseSubmit}
              data-cy="edit-course-form"
              class="flex flex-col gap-5"
            >
              <Input
                id="edit-course-title"
                name="title"
                label="Title"
                required
                placeholder={course.title}
              />
              <Input
                id="edit-course-instrument"
                name="instrument"
                label="Instrument"
                required
                placeholder={course.instrument}
              />
              <Textarea
                id="edit-course-description"
                name="description"
                label="Description"
                placeholder={course.description}
              />
              <div class="flex justify-end gap-3 mt-2">
                <Button variant="ghost" onclick={closeEditCourse}>
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
        {admin ? (
          <Modal
            open={showModuleForm}
            onclose={closeModuleForm}
            title={editing ? "Edit Module" : "Add Module"}
          >
            <form
              onsubmit={handleModuleFormSubmit}
              data-cy="module-form"
              class="flex flex-col gap-5"
            >
              <Input
                id="module-title"
                name="title"
                label="Title"
                required
                placeholder={editing ? editing.title : "Module title"}
              />
              <Textarea
                id="module-description"
                name="description"
                label="Description"
                placeholder={
                  editing?.description ?? "Optional description"
                }
              />
              <div class="flex justify-end gap-3 mt-2">
                <Button variant="ghost" onclick={closeModuleForm}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  {editing ? "Save" : "Create"}
                </Button>
              </div>
            </form>
          </Modal>
        ) : null}

        {/* ---- Delete Module Confirm Dialog ---- */}
        {admin ? (
          <ConfirmDialog
            open={delTarget !== null}
            onconfirm={confirmDeleteModule}
            oncancel={closeDeleteModule}
            title="Delete Module"
            message={
              delTarget
                ? `Are you sure you want to delete "${delTarget.title}"? This cannot be undone.`
                : ""
            }
            confirmLabel="Delete"
            variant="danger"
          />
        ) : null}

        {/* ---- Attach Material Modal ---- */}
        {admin ? (
          <Modal
            open={attachingModuleId !== null}
            onclose={closeAttachMaterial}
            title={`Attach Material${attachingModule ? ` to ${attachingModule.title}` : ""}`}
          >
            {availableMaterials.length === 0 ? (
              <p class="text-muted text-sm py-4 text-center">
                {(allMaterials as Material[]).length === 0
                  ? "No materials in the library. Upload materials from the Library page first."
                  : "All materials are already attached to this module."}
              </p>
            ) : (
              <div class="flex flex-col gap-2 max-h-80 overflow-y-auto">
                {availableMaterials.map((mat) => (
                  <button
                    type="button"
                    onclick={() => handleAttachMaterial(mat.id)}
                    class="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-surface px-4 py-3 text-sm text-left transition-colors hover:border-accent/40 hover:bg-accent/5 cursor-pointer"
                  >
                    <span class="text-primary font-medium flex-1">
                      {mat.title}
                    </span>
                    <span class="text-muted/60 text-xs">
                      {mat.original_filename}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div class="flex justify-end mt-4">
              <Button variant="ghost" onclick={closeAttachMaterial}>
                Cancel
              </Button>
            </div>
          </Modal>
        ) : null}
      </div>
    );
  });
}

/* ---------------------------------------------------------------------------
 * CourseDetailPage — public export, wraps content in Suspense
 * --------------------------------------------------------------------------- */

export const CourseDetailPage = ({ id }: { id: string }) => (
  <main class="max-w-[900px] mx-auto px-5 md:px-8 pt-20 pb-16">
    <Suspense
      fallback={<p class="text-muted">Loading course...</p>}
      threshold={50}
    >
      <CourseContent id={id} />
    </Suspense>
  </main>
);
