import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import {
  adminTodayLessonsQuery,
  adminWeekLessonsQuery,
  messagesQuery,
  adminStudentsQuery,
  adminCoursesQuery,
} from "../../lib/queries.js";
import type { Course, Message, Lesson, User } from "../../lib/types.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { CourseFormModal } from "../CourseFormModal.js";
import { formatTime, statusBadgeClass, statusLabels, locationLabels } from "./helpers.js";

export function AdminDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const today = new Date();
  const { data: todayLessons } = useSuspenseQuery(adminTodayLessonsQuery());
  const { data: weekLessons } = useSuspenseQuery(adminWeekLessonsQuery());
  const { data: messages } = useSuspenseQuery(messagesQuery);
  const { data: students } = useSuspenseQuery(adminStudentsQuery);
  const { data: courses } = useSuspenseQuery(adminCoursesQuery);

  // Modal state
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null);

  // Build student lookup
  const studentMap = new Map<string, User>();
  (students as User[]).forEach((s) => {
    studentMap.set(s.id, s);
  });

  // Today's lessons sorted by time
  const todayScheduled = [...(todayLessons as Lesson[])].sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
  );

  // Week stats
  const weekAll = weekLessons as Lesson[];
  const weekScheduledCount = weekAll.filter((l) => l.status === "scheduled").length;
  const weekCompletedCount = weekAll.filter((l) => l.status === "completed").length;
  const weekCancelledCount = weekAll.filter((l) => l.status === "cancelled").length;

  // Unread messages (not sent by me)
  const unreadMessages = (messages as Message[]).filter(
    (m) => !m.is_read && m.sender_id !== user?.id,
  );

  const firstName = user?.name ? user.name.split(" ")[0] : null;

  const deleteCourseMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.admin.courses({ id }).delete();
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "courses"] });
    },
  });

  // Handlers
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

  const openDeleteCourse = (c: Course) => () => {
    setDeleteTarget(c);
  };

  const cancelDelete = () => {
    setDeleteTarget(null);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteCourseMutation.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  return (
    <>
      {/* ---- Greeting + date ---- */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          {firstName ? `Welcome back, ${firstName}` : "Dashboard"}
        </h1>
        <p className="text-muted mt-1">
          {today.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>

      {/* ---- Today's Lessons ---- */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Today's Lessons</h2>
          <Link to="/lessons" className="text-sm text-accent hover:underline">
            All Lessons
          </Link>
        </div>
        {todayScheduled.length === 0 ? (
          <Card>
            <p className="text-muted">No lessons today</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {todayScheduled.map((lesson) => {
              const student = studentMap.get(lesson.student_id);
              const badge = statusBadgeClass[lesson.status] ?? "bg-white/10 text-muted";
              const label = statusLabels[lesson.status] ?? lesson.status;
              const location = locationLabels[lesson.location_type] ?? lesson.location_type;

              return (
                <Card key={lesson.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-primary">{student?.name ?? "Unknown"}</p>
                      <p className="text-sm text-muted">
                        {formatTime(lesson.scheduled_at)} &middot; {String(lesson.duration_minutes)} min &middot; {location}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge}`}>
                      {label}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- This Week ---- */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">This Week</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <p className="text-2xl font-bold text-primary">{String(weekScheduledCount)}</p>
            <p className="text-xs text-muted">Scheduled</p>
          </Card>
          <Card>
            <p className="text-2xl font-bold text-green-400">{String(weekCompletedCount)}</p>
            <p className="text-xs text-muted">Completed</p>
          </Card>
          <Card>
            <p className="text-2xl font-bold text-red-400">{String(weekCancelledCount)}</p>
            <p className="text-xs text-muted">Cancelled</p>
          </Card>
          <Card>
            <p className="text-2xl font-bold text-accent">{String(students.length)}</p>
            <p className="text-xs text-muted">Students</p>
          </Card>
        </div>
      </section>

      {/* ---- Unread Messages ---- */}
      {unreadMessages.length > 0 ? (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              Unread Messages
              <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent">
                {String(unreadMessages.length)}
              </span>
            </h2>
            <Link to="/messages" className="text-sm text-accent hover:underline">
              View All
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {unreadMessages.slice(0, 3).map((m) => {
              const sender = studentMap.get(m.sender_id);
              return (
                <Link key={m.id} to="/messages" className="no-underline">
                  <Card>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-primary">
                          {sender?.name ?? "Student"}
                        </p>
                        <p className="text-sm text-muted line-clamp-1">{m.body}</p>
                      </div>
                      <span className="text-xs text-muted shrink-0 ml-3">
                        {new Date(m.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ---- Quick Actions ---- */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link to="/lessons" className="no-underline">
            <Button variant="outline">Manage Lessons</Button>
          </Link>
          <Link to="/students" className="no-underline">
            <Button variant="outline">Students</Button>
          </Link>
          <Link to="/submissions" className="no-underline">
            <Button variant="outline">Submissions</Button>
          </Link>
          <Link to="/settings" className="no-underline">
            <Button variant="outline">Settings</Button>
          </Link>
        </div>
      </section>

      {/* ---- Courses ---- */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Courses</h2>
          <Button data-pwid="new-course" onClick={openNewCourse}>
            New Course
          </Button>
        </div>
        {courses.length === 0 ? (
          <Card>
            <p className="text-muted">No courses yet.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {(courses as Course[]).map((c) => (
              <Card key={c.id}>
                <Link to="/courses/$id" params={{ id: c.id }} className="block no-underline">
                  <div className="flex items-start justify-between">
                    <p className="font-medium text-primary">{c.title}</p>
                    <span className="rounded-full bg-accent/[0.12] px-2 py-0.5 text-xs font-semibold text-accent shrink-0 ml-2">
                      {c.instrument}
                    </span>
                  </div>
                </Link>
                <div className="flex gap-2 mt-4 pt-3 border-t border-white/[0.06]">
                  <Button
                    variant="ghost"
                    onClick={openEditCourse(c)}
                    className="text-xs px-3 py-1.5"
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={openDeleteCourse(c)}
                    className="text-xs px-3 py-1.5 text-red-400 hover:text-red-300"
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ---- Course Form Modal (New / Edit) ---- */}
      <CourseFormModal
        open={courseFormOpen}
        onClose={closeCourseForm}
        course={editingCourse}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["admin", "courses"] })}
      />

      {/* ---- Delete Confirm Dialog ---- */}
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
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </>
  );
}
