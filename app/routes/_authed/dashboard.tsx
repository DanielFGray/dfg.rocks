import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { Course, Message, Lesson, Material, User } from "../../lib/types.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Input } from "../../components/ui/Input.js";
import { Select } from "../../components/ui/Select.js";
import { Textarea } from "../../components/ui/Textarea.js";
import { Modal } from "../../components/ui/Modal.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

/* ---------------------------------------------------------------------------
 * Query Options
 * --------------------------------------------------------------------------- */

const todayDate = () => new Date().toISOString().slice(0, 10);

const adminTodayLessonsQuery = () => {
  const todayStr = todayDate();
  const todayStart = `${todayStr}T00:00:00.000Z`;
  const todayEnd = `${todayStr}T23:59:59.999Z`;
  return queryOptions({
    queryKey: ["admin", "lessons", "today", todayStr],
    queryFn: async () => {
      const { data, error } = await api.admin.lessons.get({ query: { from: todayStart, to: todayEnd } });
      if (error) throw error;
      return data;
    },
  });
};

const adminWeekLessonsQuery = () => {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart = monday.toISOString().slice(0, 10) + "T00:00:00.000Z";
  const weekEnd = sunday.toISOString().slice(0, 10) + "T23:59:59.999Z";
  return queryOptions({
    queryKey: ["admin", "lessons", "week", weekStart],
    queryFn: async () => {
      const { data, error } = await api.admin.lessons.get({ query: { from: weekStart, to: weekEnd } });
      if (error) throw error;
      return data;
    },
  });
};

const messagesQuery = queryOptions({
  queryKey: ["messages"],
  queryFn: async () => {
    const { data, error } = await api.messages.get();
    if (error) throw error;
    return data;
  },
});

const adminStudentsQuery = queryOptions({
  queryKey: ["admin", "students"],
  queryFn: async () => {
    const { data, error } = await api.admin.students.get();
    if (error) throw error;
    return data;
  },
});

const adminCoursesQuery = queryOptions({
  queryKey: ["admin", "courses"],
  queryFn: async () => {
    const { data, error } = await api.admin.courses.get();
    if (error) throw error;
    return data;
  },
});

const studentScheduledLessonsQuery = queryOptions({
  queryKey: ["my-lessons", "scheduled"],
  queryFn: async () => {
    const { data, error } = await api["my-lessons"].get({ query: { status: "scheduled", limit: 5 } });
    if (error) throw error;
    return data;
  },
});

const studentAssignmentsQuery = queryOptions({
  queryKey: ["assignments"],
  queryFn: async () => {
    const { data, error } = await api.assignments.get();
    if (error) throw error;
    return data;
  },
});

const studentCoursesQuery = queryOptions({
  queryKey: ["courses"],
  queryFn: async () => {
    const { data, error } = await api.courses.get();
    if (error) throw error;
    return data;
  },
});

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

export const Route = createFileRoute("/_authed/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard | DFG Portal" }] }),
  loader: async ({ context: { queryClient } }) => {
    await Promise.allSettled([
      // Admin queries
      queryClient.ensureQueryData(adminTodayLessonsQuery()),
      queryClient.ensureQueryData(adminWeekLessonsQuery()),
      queryClient.ensureQueryData(messagesQuery),
      queryClient.ensureQueryData(adminStudentsQuery),
      queryClient.ensureQueryData(adminCoursesQuery),
      // Student queries
      queryClient.ensureQueryData(studentScheduledLessonsQuery),
      queryClient.ensureQueryData(studentAssignmentsQuery),
      queryClient.ensureQueryData(studentCoursesQuery),
    ]);
  },
  component: DashboardPage,
  pendingComponent: () => <div>Loading...</div>,
});

/* ---------------------------------------------------------------------------
 * Constants
 * --------------------------------------------------------------------------- */

const instruments = ["Guitar", "Piano", "Drums", "Bass", "Other"] as const;

const instrumentOptions = [
  { value: "", label: "Select instrument..." },
  ...instruments.map((i) => ({ value: i, label: i })),
];

/* ---------------------------------------------------------------------------
 * Helpers — formatting
 * --------------------------------------------------------------------------- */

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const statusBadgeClass: Record<string, string> = {
  scheduled: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  cancelled: "bg-red-500/20 text-red-400",
  no_show: "bg-amber-500/20 text-amber-400",
};

const statusLabels: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

const locationLabels: Record<string, string> = {
  in_person_teacher_travels: "Teacher Travels",
  in_person_student_travels: "Student Travels",
  studio: "Studio",
  online: "Online",
};

const locationLabel: Record<string, string> = {
  in_person_teacher_travels: "In-Person",
  in_person_student_travels: "In-Person",
  studio: "Studio",
  online: "Online",
};

/* ---------------------------------------------------------------------------
 * DashboardPage — branches between admin and student views
 * --------------------------------------------------------------------------- */

function DashboardPage() {
  const { isAdmin } = useAuth();

  return (
    <main
      data-pwid="dashboard"
      className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16"
    >
      {isAdmin ? <AdminDashboard /> : <StudentDashboard />}
    </main>
  );
}

/* ---------------------------------------------------------------------------
 * AdminDashboard — daily overview for admins
 * --------------------------------------------------------------------------- */

function AdminDashboard() {
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

  // Mutations
  const createCourseMutation = useMutation({
    mutationFn: async (payload: { title: string; instrument: string; description?: string }) => {
      const { data, error } = await api.admin.courses.post(payload);
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "courses"] });
    },
  });

  const updateCourseMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: { title: string; instrument: string; description?: string } }) => {
      const { data, error } = await api.admin.courses[id].patch(payload);
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "courses"] });
    },
  });

  const deleteCourseMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.admin.courses[id].delete();
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

  const handleCourseFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const payload = {
      title: data.get("title") as string,
      instrument: data.get("instrument") as string,
      description: (data.get("description") as string) || undefined,
    };

    if (editingCourse) {
      updateCourseMutation.mutate({ id: editingCourse.id, payload }, {
        onSuccess: () => closeCourseForm(),
      });
    } else {
      createCourseMutation.mutate(payload, {
        onSuccess: () => closeCourseForm(),
      });
    }
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

  const formTitle = editingCourse ? "Edit Course" : "New Course";

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
      <Modal
        open={courseFormOpen}
        onClose={closeCourseForm}
        title={formTitle}
      >
        <form
          data-pwid="course-form"
          onSubmit={handleCourseFormSubmit}
          className="flex flex-col gap-5"
        >
          <Input
            id="course-title"
            name="title"
            label="Title"
            required
            defaultValue={editingCourse?.title}
            key={editingCourse?.id ?? "new"}
            placeholder="e.g. Fingerpicking Foundations"
          />
          <Select
            id="course-instrument"
            name="instrument"
            label="Instrument"
            options={instrumentOptions}
            value={editingCourse?.instrument}
            required
          />
          <Textarea
            id="course-description"
            name="description"
            label="Description"
            rows={3}
            defaultValue={editingCourse?.description}
            key={`desc-${editingCourse?.id ?? "new"}`}
            placeholder="Brief description of the course"
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={closeCourseForm}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              {editingCourse ? "Save Changes" : "Create Course"}
            </Button>
          </div>
        </form>
      </Modal>

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

/* ---------------------------------------------------------------------------
 * StudentDashboard — landing page for non-admin users
 * --------------------------------------------------------------------------- */

function StudentDashboard() {
  const { user } = useAuth();

  const { data: messages } = useSuspenseQuery(messagesQuery);
  const { data: lessons } = useSuspenseQuery(studentScheduledLessonsQuery);
  const { data: assignments } = useSuspenseQuery(studentAssignmentsQuery);
  const { data: courses } = useSuspenseQuery(studentCoursesQuery);

  // Unread messages (from teacher, not sent by me)
  const unread = (messages as Message[]).filter(
    (m) => !m.is_read && m.sender_id !== user?.id,
  );

  // Next upcoming lessons
  const now = new Date();
  const upcoming = (lessons as Lesson[])
    .filter((l) => new Date(l.scheduled_at) > now)
    .sort(
      (a, b) =>
        new Date(a.scheduled_at).getTime() -
        new Date(b.scheduled_at).getTime(),
    );

  const firstName = user?.name ? user.name.split(" ")[0] : null;

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight mb-8">
        {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
      </h1>

      {/* ---- Unread Messages ---- */}
      {unread.length > 0 ? (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">New Messages</h2>
            <Link
              to="/messages"
              className="text-sm text-accent hover:underline"
            >
              View All
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {unread.slice(0, 3).map((m) => (
              <Link key={m.id} to="/messages" className="no-underline">
                <Card>
                  <p className="text-sm text-primary line-clamp-2">{m.body}</p>
                  <p className="text-xs text-muted mt-1">
                    {new Date(m.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Next Lesson ---- */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Next Lesson</h2>
        {upcoming.length > 0 ? (
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-primary font-medium">
                  {new Date(upcoming[0]!.scheduled_at).toLocaleDateString(
                    "en-US",
                    { weekday: "long", month: "long", day: "numeric" },
                  )}
                </p>
                <p className="text-sm text-muted">
                  {new Date(upcoming[0]!.scheduled_at).toLocaleTimeString(
                    "en-US",
                    { hour: "numeric", minute: "2-digit" },
                  )}
                  {" \u00B7 "}
                  {String(upcoming[0]!.duration_minutes)} min
                  {" \u00B7 "}
                  {locationLabel[upcoming[0]!.location_type] ??
                    upcoming[0]!.location_type}
                </p>
              </div>
              <Link
                to="/my-lessons"
                className="text-sm text-accent hover:underline"
              >
                All Lessons
              </Link>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-muted">No upcoming lessons</p>
              <Link to="/book-lesson" className="no-underline">
                <Button variant="primary" className="text-sm">
                  Book a Lesson
                </Button>
              </Link>
            </div>
          </Card>
        )}
      </section>

      {/* ---- Assignments ---- */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Assignments</h2>
          <Link
            to="/assignments"
            className="text-sm text-accent hover:underline"
          >
            View All
          </Link>
        </div>
        {assignments.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {(assignments as Material[]).slice(0, 6).map((a) => (
              <Card key={a.id}>
                <p className="font-medium text-primary text-sm">{a.title}</p>
                <p className="text-xs text-muted mt-1">{a.original_filename}</p>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <p className="text-muted">
              No assignments yet. Materials assigned by your teacher will
              appear here.
            </p>
          </Card>
        )}
      </section>

      {/* ---- My Courses (compact) ---- */}
      {courses.length > 0 ? (
        <section>
          <h2 className="text-lg font-semibold mb-4">My Courses</h2>
          <div className="flex flex-col gap-2">
            {(courses as Course[]).map((c) => (
              <Link key={c.id} to="/courses/$id" params={{ id: c.id }} className="no-underline">
                <Card>
                  <div className="flex items-center justify-between">
                    <span className="text-primary font-medium text-sm">
                      {c.title}
                    </span>
                    <span className="rounded-full bg-accent/[0.12] px-2.5 py-0.5 text-xs font-semibold text-accent">
                      {c.instrument}
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
