import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { Course } from "../../lib/types.js";
import { getCoursesIndexPageData } from "../../lib/routeData.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { CourseFormModal } from "../../components/CourseFormModal.js";

export const Route = createFileRoute("/_authed/courses/")({
  head: () => ({ meta: [{ title: "Courses | DFG Portal" }] }),
  loader: () => getCoursesIndexPageData(),
  component: CoursesPage,
  pendingComponent: () => (
    <main className="px-5 md:px-8 pt-20 pb-16 text-muted dark:text-muted-dark mx-auto max-w-[1100px]">
      Loading...
    </main>
  ),
});

function CoursesPage() {
  const { isAdmin } = Route.useLoaderData();
  return isAdmin ? <AdminCourses /> : <StudentCourses />;
}

export function AdminCourses() {
  const router = useRouter();
  const { courses } = Route.useLoaderData();

  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null);

  const deleteCourseMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.admin.courses({ id }).delete();
      if (error) throw error;
      if ("error" in data) throw data.error;
      return data;
    },
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
    <main data-testid="courses" className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[1100px]">
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
        <div className="gap-3 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {courses.map((c) => (
            <Card key={c.id}>
              <Link to="/courses/$id" params={{ id: c.id }} className="block no-underline">
                <div className="flex items-start justify-between">
                  <p className="font-medium text-primary dark:text-primary-dark">{c.title}</p>
                  <span className="bg-accent/12 px-2 py-0.5 text-xs font-semibold text-accent ml-2 shrink-0 rounded-full">
                    {c.instrument}
                  </span>
                </div>
              </Link>
              <div className="gap-2 mt-4 pt-3 border-overlay/6 dark:border-overlay-dark/6 flex border-t">
                <Button variant="ghost" onClick={openEditCourse(c)} className="text-xs px-3 py-1.5">
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setDeleteTarget(c)}
                  className="text-xs px-3 py-1.5 text-red-600 dark:text-red-400 hover:text-red-300"
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
    </main>
  );
}

export function StudentCourses() {
  const { courses } = Route.useLoaderData();

  return (
    <main data-testid="courses" className="pt-20 pb-16 mx-auto max-w-[1100px]">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">My Courses</h1>
      </div>

      {courses.length === 0 ? (
        <EmptyState message="You're not enrolled in any courses yet." />
      ) : (
        <div className="gap-2 flex flex-col">
          {courses.map((c) => (
            <Link key={c.id} to="/courses/$id" params={{ id: c.id }} className="no-underline">
              <Card>
                <div className="flex items-center justify-between">
                  <span className="text-primary dark:text-primary-dark font-medium">{c.title}</span>
                  <span className="bg-accent/12 px-2.5 py-0.5 text-sm font-semibold text-accent rounded-full">
                    {c.instrument}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
