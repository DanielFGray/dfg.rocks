import { Link } from "@tanstack/react-router";
import type { Course, Message, Lesson, User } from "../../../shared/schemas.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { formatTime, statusBadgeClass, statusLabels, locationLabels } from "./helpers.js";

export function AdminDashboard({
  todayLessons,
  weekLessons,
  messages,
  students,
  courses,
}: {
  todayLessons: Lesson[];
  weekLessons: Lesson[];
  messages: Message[];
  students: User[];
  courses: Course[];
}) {
  const { user } = useAuth();

  const today = new Date();

  // Build student lookup
  const studentMap = new Map(students.map((s) => [s.id, s]));

  // Today's lessons sorted by time
  const todayScheduled = [...todayLessons].sort(
    (a, b) => a.scheduled_at.getTime() - b.scheduled_at.getTime(),
  );

  // Week stats
  const weekAll = weekLessons;
  const weekScheduledCount = weekAll.filter((l) => l.status === "scheduled").length;
  const weekCompletedCount = weekAll.filter((l) => l.status === "completed").length;
  const weekCancelledCount = weekAll.filter((l) => l.status === "cancelled").length;

  // Unread messages (not sent by me)
  const unreadMessages = messages.filter((m) => !m.is_read && m.sender_id !== user?.id);

  const firstName = user?.name ? user.name.split(" ")[0] : null;
  const showCoursesPreview = students.length === 0;

  return (
    <>
      {/* ---- Greeting + date ---- */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          {firstName ? `Welcome back, ${firstName}` : "Dashboard"}
        </h1>
        <p className="mt-1 text-muted dark:text-muted-dark">
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
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Today's Lessons</h2>
          <Link to="/lessons" className="text-sm text-accent hover:underline">
            All Lessons
          </Link>
        </div>
        {todayScheduled.length === 0 ? (
          <Card>
            <p className="text-muted dark:text-muted-dark">No lessons today</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {todayScheduled.map((lesson) => {
              const student = studentMap.get(lesson.student_id);
              const badge =
                statusBadgeClass[lesson.status] ??
                "bg-overlay/10 dark:bg-overlay-dark/10 text-muted dark:text-muted-dark";
              const label = statusLabels[lesson.status] ?? lesson.status;
              const location = locationLabels[lesson.location_type] ?? lesson.location_type;

              return (
                <Card key={lesson.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-primary dark:text-primary-dark">
                        {student?.name ?? "Unknown"}
                      </p>
                      <p className="text-sm text-muted dark:text-muted-dark">
                        {formatTime(lesson.scheduled_at)} &middot; {String(lesson.duration_minutes)}{" "}
                        min &middot; {location}
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
        <h2 className="mb-4 text-lg font-semibold">This Week</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <p className="text-2xl font-bold text-primary dark:text-primary-dark">
              {String(weekScheduledCount)}
            </p>
            <p className="text-xs text-muted dark:text-muted-dark">Scheduled</p>
          </Card>
          <Card>
            <p className="text-2xl font-bold text-green-400">{String(weekCompletedCount)}</p>
            <p className="text-xs text-muted dark:text-muted-dark">Completed</p>
          </Card>
          <Card>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">
              {String(weekCancelledCount)}
            </p>
            <p className="text-xs text-muted dark:text-muted-dark">Cancelled</p>
          </Card>
          <Card>
            <p className="text-2xl font-bold text-accent">{String(students.length)}</p>
            <p className="text-xs text-muted dark:text-muted-dark">Students</p>
          </Card>
        </div>
      </section>

      {/* ---- Courses ---- */}
      {showCoursesPreview ? (
        <section className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Courses</h2>
            <Link to="/courses" className="text-sm text-accent hover:underline">
              View All
            </Link>
          </div>
          {courses.length === 0 ? (
            <Card>
              <p className="text-muted dark:text-muted-dark">No courses yet</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {courses.slice(0, 4).map((course) => (
                <Link
                  key={course.id}
                  to="/courses/$id"
                  params={{ id: course.id }}
                  className="no-underline"
                >
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-primary dark:text-primary-dark">
                          {course.title}
                        </p>
                        <p className="mt-1 text-sm text-muted dark:text-muted-dark">
                          {course.description}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-accent/12 px-2 py-0.5 text-xs font-semibold text-accent">
                        {course.instrument}
                      </span>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* ---- Unread Messages ---- */}
      {unreadMessages.length > 0 ? (
        <section className="mb-8">
          <div className="mb-4 flex items-center justify-between">
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
            {Array.from(
              unreadMessages
                .reduce((groups, m) => {
                  const existing = groups.get(m.sender_id);
                  if (existing) {
                    existing.count++;
                    if (m.created_at > existing.latest.created_at) {
                      existing.latest = m;
                    }
                  } else {
                    groups.set(m.sender_id, { sender_id: m.sender_id, count: 1, latest: m });
                  }
                  return groups;
                }, new Map<string, { sender_id: string; count: number; latest: Message }>())
                .values(),
            )
              .slice(0, 3)
              .map((g) => {
                const sender = studentMap.get(g.sender_id);
                return (
                  <Link key={g.sender_id} to="/messages" className="no-underline">
                    <Card>
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-primary dark:text-primary-dark">
                            {sender?.name ?? "Student"}
                            {g.count > 1 ? (
                              <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent">
                                {String(g.count)}
                              </span>
                            ) : null}
                          </p>
                          <p className="line-clamp-1 text-sm text-muted dark:text-muted-dark">
                            {g.latest.body}
                          </p>
                        </div>
                        <span className="ml-3 shrink-0 text-xs text-muted dark:text-muted-dark">
                          {g.latest.created_at.toLocaleDateString("en-US", {
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
      <section>
        <h2 className="mb-4 text-lg font-semibold">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link to="/courses" className="no-underline">
            <Button variant="outline">Courses</Button>
          </Link>
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
    </>
  );
}
