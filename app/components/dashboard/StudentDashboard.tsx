import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  messagesQuery,
  scheduledLessonsQuery,
  assignmentsQuery,
  coursesQuery,
} from "../../lib/queries.js";
import type { Course, Message, Lesson, Material } from "../../lib/types.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { locationLabel } from "./helpers.js";

export function StudentDashboard() {
  const { user } = useAuth();

  const { data: messages } = useSuspenseQuery(messagesQuery);
  const { data: lessons } = useSuspenseQuery(scheduledLessonsQuery);
  const { data: assignments } = useSuspenseQuery(assignmentsQuery);
  const { data: courses } = useSuspenseQuery(coursesQuery);

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
