import * as Effect from "effect/Effect";
import { Atom, AtomRegistry, Suspense } from "fibrae";
import { NavigatorTag, Link } from "fibrae/router";
import { DfgApi, type Course } from "./api.js";
import { currentUser, isAdmin } from "./auth.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Textarea } from "../ui/textarea.js";
import { Modal } from "../ui/modal.js";
import { ConfirmDialog } from "../ui/confirm_dialog.js";
import { EmptyState } from "../ui/empty_state.js";

/* ---------------------------------------------------------------------------
 * Atoms for modal / dialog state
 * --------------------------------------------------------------------------- */

const courseFormOpen = Atom.make<boolean>(false);
const editingCourse = Atom.make<Course | null>(null);
const deleteTarget = Atom.make<Course | null>(null);

/* ---------------------------------------------------------------------------
 * Instruments
 * --------------------------------------------------------------------------- */

const instruments = [
  "Guitar",
  "Piano",
  "Drums",
  "Bass",
  "Ukulele",
  "Voice",
  "Violin",
  "Other",
] as const;

const instrumentOptions = [
  { value: "", label: "Select instrument..." },
  ...instruments.map((i) => ({ value: i, label: i })),
];

/* ---------------------------------------------------------------------------
 * CourseList — the main Effect component
 * --------------------------------------------------------------------------- */

function CourseList() {
  return Effect.gen(function* () {
    const api = yield* DfgApi;
    const registry = yield* AtomRegistry.AtomRegistry;
    const user = registry.get(currentUser);
    const admin = isAdmin(user);

    const courses = admin ? yield* api.admin.adminCourses({}) : yield* api.authenticated.courses({});

    /* -- helpers to refresh the page after mutations -- */
    const refresh = Effect.gen(function* () {
      const navigator = yield* NavigatorTag;
      yield* navigator.go("/dashboard");
    });

    /* -- Read atom values for modal state -- */
    const formOpen = registry.get(courseFormOpen);
    const editing = registry.get(editingCourse);
    const deleting = registry.get(deleteTarget);

    /* -- Admin handlers -- */
    const openNewCourse = () => {
      registry.set(editingCourse, null);
      registry.set(courseFormOpen, true);
    };

    const openEditCourse = (c: Course) => () => {
      registry.set(editingCourse, c);
      registry.set(courseFormOpen, true);
    };

    const closeCourseForm = () => {
      registry.set(courseFormOpen, false);
      registry.set(editingCourse, null);
    };

    const handleCourseFormSubmit = (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const data = new FormData(form);
      const course = registry.get(editingCourse);
      const payload = {
        title: data.get("title") as string,
        instrument: data.get("instrument") as string,
        description: (data.get("description") as string) || undefined,
      };

      return Effect.gen(function* () {
        const api = yield* DfgApi;
        if (course) {
          yield* Effect.either(api.admin.updateCourse({ path: { id: course.id }, payload }));
        } else {
          yield* Effect.either(api.admin.createCourse({ payload }));
        }
        registry.set(courseFormOpen, false);
        registry.set(editingCourse, null);
        yield* refresh;
      });
    };

    const openDeleteCourse = (c: Course) => () => {
      registry.set(deleteTarget, c);
    };

    const cancelDelete = () => {
      registry.set(deleteTarget, null);
    };

    const confirmDelete = () => {
      const target = registry.get(deleteTarget);
      if (!target) return;
      registry.set(deleteTarget, null);
      return Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* Effect.either(api.admin.deleteCourse({ path: { id: target.id } }));
        yield* refresh;
      });
    };

    /* -- Heading -- */
    const heading = admin ? "Courses" : "My Courses";
    const formTitle = editing ? "Edit Course" : "New Course";

    /* -- Empty state -- */
    if (courses.length === 0) {
      return (
        <div>
          <div class="flex items-center justify-between mb-8">
            <h1 class="text-3xl font-bold tracking-tight">{heading}</h1>
            {admin ? (
              <Button data-cy="new-course" onclick={openNewCourse}>
                New Course
              </Button>
            ) : null}
          </div>
          <EmptyState
            message={
              admin
                ? "No courses yet. Create your first course to get started."
                : "No courses yet. Your enrolled courses will appear here."
            }
            action={
              admin
                ? { label: "New Course", onclick: openNewCourse }
                : undefined
            }
          />
          {admin ? (
            <Modal
              open={formOpen}
              onclose={closeCourseForm}
              title={formTitle}
            >
              <form
                data-cy="course-form"
                onsubmit={handleCourseFormSubmit}
                class="flex flex-col gap-5"
              >
                <Input
                  id="course-title"
                  name="title"
                  label="Title"
                  required
                  value={editing?.title}
                  placeholder="e.g. Fingerpicking Foundations"
                />
                <Select
                  id="course-instrument"
                  name="instrument"
                  label="Instrument"
                  options={instrumentOptions}
                  value={editing?.instrument}
                  required
                />
                <Textarea
                  id="course-description"
                  name="description"
                  label="Description"
                  rows={3}
                  value={editing?.description}
                  placeholder="Brief description of the course"
                />
                <div class="flex justify-end gap-3 pt-2">
                  <Button variant="ghost" onclick={closeCourseForm}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary">
                    {editing ? "Save Changes" : "Create Course"}
                  </Button>
                </div>
              </form>
            </Modal>
          ) : null}
        </div>
      );
    }

    /* -- Course grid -- */
    return (
      <div>
        <div class="flex items-center justify-between mb-8">
          <h1 class="text-3xl font-bold tracking-tight">{heading}</h1>
          {admin ? (
            <Button data-cy="new-course" onclick={openNewCourse}>
              New Course
            </Button>
          ) : null}
        </div>

        <div
          id="courses-list"
          class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5"
        >
          {courses.map((c) => (
            <Card>
              <Link
                href={`/courses/${c.id}`}
                class="block no-underline"
              >
                <div class="flex items-start justify-between mb-3">
                  <h2 class="text-lg font-semibold text-primary">
                    {c.title}
                  </h2>
                  <span class="rounded-full bg-accent/[0.12] px-3 py-1 text-xs font-semibold text-accent shrink-0 ml-3">
                    {c.instrument}
                  </span>
                </div>
                <p class="text-sm text-muted">{c.description}</p>
              </Link>
              {admin ? (
                <div class="flex gap-2 mt-4 pt-3 border-t border-white/[0.06]">
                  <Button
                    variant="ghost"
                    onclick={openEditCourse(c)}
                    class="text-xs px-3 py-1.5"
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    onclick={openDeleteCourse(c)}
                    class="text-xs px-3 py-1.5 text-red-400 hover:text-red-300"
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </Card>
          ))}
        </div>

        {/* ---- Course Form Modal (New / Edit) ---- */}
        {admin ? (
          <Modal
            open={formOpen}
            onclose={closeCourseForm}
            title={formTitle}
          >
            <form
              data-cy="course-form"
              onsubmit={handleCourseFormSubmit}
              class="flex flex-col gap-5"
            >
              <Input
                id="course-title"
                name="title"
                label="Title"
                required
                value={editing?.title}
                placeholder="e.g. Fingerpicking Foundations"
              />
              <Select
                id="course-instrument"
                name="instrument"
                label="Instrument"
                options={instrumentOptions}
                value={editing?.instrument}
                required
              />
              <Textarea
                id="course-description"
                name="description"
                label="Description"
                rows={3}
                value={editing?.description}
                placeholder="Brief description of the course"
              />
              <div class="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onclick={closeCourseForm}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  {editing ? "Save Changes" : "Create Course"}
                </Button>
              </div>
            </form>
          </Modal>
        ) : null}

        {/* ---- Delete Confirm Dialog ---- */}
        {admin ? (
          <ConfirmDialog
            open={deleting !== null}
            title="Delete Course"
            message={
              deleting
                ? `Are you sure you want to delete "${deleting.title}"? This action cannot be undone.`
                : ""
            }
            confirmLabel="Delete"
            variant="danger"
            onconfirm={confirmDelete}
            oncancel={cancelDelete}
          />
        ) : null}
      </div>
    );
  });
}

/* ---------------------------------------------------------------------------
 * DashboardPage — public export, wraps content in Suspense
 * --------------------------------------------------------------------------- */

export const DashboardPage = () => (
  <main
    data-cy="dashboard"
    class="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16"
  >
    <Suspense
      fallback={<p class="text-muted">Loading courses...</p>}
      threshold={50}
    >
      <CourseList />
    </Suspense>
  </main>
);
