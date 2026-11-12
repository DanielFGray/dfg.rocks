import { Effect } from "effect";
import { withAuthContext } from "../../../server/requestDatabase.js";
import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import type { Course } from "../../../shared/schemas.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { CourseFormModal } from "../../components/CourseFormModal.js";
import { Main } from "../../components/ui/Container.js";
import { runServerEffect } from "../../lib/serverEffect.js";
import { serializeCourse } from "../../../shared/responseMappers.js";
import { Sessions, resolveEffectiveStudent } from "../../../server/services/sessions.js";
import { Courses } from "../../../server/services/courses.js";

type CoursesPageData = Course[];

const getCoursesPageData = createServerFn({ method: "GET" }).handler(() =>
  runServerEffect(
    Effect.gen(function* () {
      const session = yield* Sessions.use((sessions) =>
        sessions.requireSession(getCookie("session")),
      );
      const effective = resolveEffectiveStudent(session);
      const filterStudentId = effective.isActing ? effective.studentId : undefined;
      const data = yield* Courses.use((courseService) =>
        courseService.courses(filterStudentId).pipe(withAuthContext(session.session.id)),
      );
      return data.map(serializeCourse) satisfies CoursesPageData;
    }),
  ),
);

export const Route = createFileRoute("/_authed/courses/")({
  head: () => ({ meta: [{ title: "Courses | DFG Portal" }] }),
  loader: () => getCoursesPageData(),
  component: CoursesPage,
  pendingComponent: () => <Main className="text-muted dark:text-muted-dark">Loading...</Main>,
});

function CoursesPage() {
  const { isAdmin } = useAuth();
  const courses = Route.useLoaderData();

  return isAdmin ? <AdminCourses courses={courses} /> : <StudentCourses courses={courses} />;
}

export function AdminCourses({ courses }: { courses: readonly Course[] }) {
  const router = useRouter();

  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null);

  const deleteCourseMutation = useMutation({
    mutationFn: (id: string) =>
      Effect.runPromise(api.coursesAdmin.deleteCourse({ params: { id } })),
    onSettled: () => {
      void router.invalidate();
    },
  });

  const openNewCourse = () => {
    setEditingCourse(null);
    setCourseFormOpen(true);
  };

  const openEditCourse = (c: Course) => () => {
    setEditingCourse(c);
    setCourseFormOpen(true);
  };

  const closeCourseForm = () => {
    setCourseFormOpen(false);
    setEditingCourse(null);
  };

  return (
    <Main data-testid="courses">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Courses</h1>
        <Button data-testid="new-course" onClick={openNewCourse}>
          New Course
        </Button>
      </div>

      {courses.length === 0 ? (
        <EmptyState
          message="No courses yet. Create your first course."
          action={{ label: "New Course", onClick: openNewCourse }}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {courses.map((c) => (
            <Card key={c.id}>
              <Link to="/courses/$id" params={{ id: c.id }} className="block no-underline">
                <div className="flex items-start justify-between">
                  <p className="font-medium text-primary dark:text-primary-dark">{c.title}</p>
                  <span className="ml-2 shrink-0 rounded-full bg-accent/12 px-2 py-0.5 text-xs font-semibold text-accent">
                    {c.instrument}
                  </span>
                </div>
              </Link>
              <div className="mt-4 flex gap-2 border-t border-overlay/6 pt-3 dark:border-overlay-dark/6">
                <Button variant="ghost" onClick={openEditCourse(c)} className="px-3 py-1.5 text-xs">
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setDeleteTarget(c)}
                  className="px-3 py-1.5 text-xs text-red-600 hover:text-red-300 dark:text-red-400"
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CourseFormModal
        open={courseFormOpen}
        onClose={closeCourseForm}
        course={editingCourse}
        onSuccess={() => void router.invalidate()}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Course"
        message={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.title}"? This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteCourseMutation.mutate(deleteTarget.id, {
            onSuccess: () => setDeleteTarget(null),
          });
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </Main>
  );
}

export function StudentCourses({ courses }: { courses: readonly Course[] }) {
  return (
    <Main data-testid="courses">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">My Courses</h1>
      </div>

      {courses.length === 0 ? (
        <EmptyState message="You're not enrolled in any courses yet." />
      ) : (
        <div className="flex flex-col gap-2">
          {courses.map((c) => (
            <Link key={c.id} to="/courses/$id" params={{ id: c.id }} className="no-underline">
              <Card>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-primary dark:text-primary-dark">{c.title}</span>
                  <span className="rounded-full bg-accent/12 px-2.5 py-0.5 text-sm font-semibold text-accent">
                    {c.instrument}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Main>
  );
}
