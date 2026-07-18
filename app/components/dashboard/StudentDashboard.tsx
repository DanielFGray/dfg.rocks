import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { Message, Lesson, Material, Course, Testimonial } from "../../../shared/schemas.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { practiceLogsQuery } from "../../lib/queries.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { locationLabel } from "./helpers.js";
import { getDefaultBookingDate } from "../../routes/_authed/book-lesson.js";
import { TestimonialEditor } from "../testimonials/TestimonialEditor.js";

export function StudentDashboard({
  messages,
  lessons,
  assignments,
  courses,
  testimonial,
  canShowTestimonialPrompt,
  onRefresh,
}: {
  messages: Message[];
  lessons: Lesson[];
  assignments: Material[];
  courses: Course[];
  testimonial: Testimonial | null;
  canShowTestimonialPrompt: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { user } = useAuth();

  // Unread messages (from teacher, not sent by me)
  const unread = messages.filter((m) => !m.is_read && m.sender_id !== user?.id);

  // Next upcoming lessons
  const now = new Date();
  const upcoming = lessons
    .filter((l) => new Date(l.scheduled_at) > now)
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  const firstName = user?.name ? user.name.split(" ")[0] : null;

  const { data: logs = [] } = useQuery(practiceLogsQuery);
  const materialsById = new Map(assignments.map((a) => [a.id, a]));

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">
        {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
      </h1>

      {testimonial || !canShowTestimonialPrompt ? null : (
        <TestimonialEditor testimonial={null} onRefresh={onRefresh} mode="dashboard" />
      )}

      {/* ---- Unread Messages ---- */}
      {unread.length > 0 ? (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">New Messages</h2>
            <Link to="/messages" className="text-sm text-accent hover:underline">
              View All
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {unread.slice(0, 3).map((m) => (
              <Link key={m.id} to="/messages" className="no-underline">
                <Card>
                  <p className="line-clamp-2 text-sm text-primary dark:text-primary-dark">
                    {m.body}
                  </p>
                  <p className="mt-1 text-xs text-muted dark:text-muted-dark">
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

      {/* ---- Assignments ---- */}
      {assignments.length > 0 ? (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Assignments</h2>
            <Link to="/assignments" className="text-sm text-accent hover:underline">
              View All
            </Link>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {assignments.slice(0, 6).map((a) => (
              <Link
                key={a.id}
                to="/assignments/$materialId"
                params={{ materialId: a.id }}
                className="no-underline"
              >
                <Card>
                  <p className="text-sm font-medium text-primary dark:text-primary-dark">
                    {a.title}
                  </p>
                  <p className="mt-1 text-xs text-muted dark:text-muted-dark">
                    {a.original_filename}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Recent Practice ---- */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Practice</h2>
        </div>
        {logs.length === 0 ? (
          <Card>
            <p className="text-sm text-muted dark:text-muted-dark">
              No practice logged yet. Check your assignments to get started!
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {logs.slice(0, 5).map((log) => {
              const material = materialsById.get(log.material_id);
              return (
                <Link
                  key={log.id}
                  to="/assignments/$materialId"
                  params={{ materialId: log.material_id }}
                  className="no-underline"
                >
                  <Card>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-primary dark:text-primary-dark truncate">
                        {material?.title ?? "Unknown material"}
                      </p>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted dark:text-muted-dark">
                      {log.rating != null ? (
                        <span>{String(log.rating)}/5 ★</span>
                      ) : null}
                      {log.duration_minutes != null ? (
                        <span>{log.duration_minutes} min</span>
                      ) : null}
                      <span>{relativeTime(log.logged_at)}</span>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-8 flex items-center justify-between">
          <h2 className="text-3xl font-bold tracking-tight">My Courses</h2>
          <Link to="/courses" className="text-sm text-accent hover:underline">
            View All
          </Link>
        </div>

        {courses.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            {courses.map((course) => (
              <Link
                key={course.id}
                to="/courses/$id"
                params={{ id: course.id }}
                className="no-underline"
              >
                <Card>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-primary dark:text-primary-dark">
                      {course.title}
                    </span>
                    <span className="rounded-full bg-accent/12 px-2.5 py-0.5 text-sm font-semibold text-accent">
                      {course.instrument}
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ---- Next Lesson ---- */}
      <section>
        <h2 className="mb-4 text-3xl font-semibold">Next Lesson</h2>
        {upcoming.length > 0 ? (
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-primary dark:text-primary-dark">
                  {new Date(upcoming[0]!.scheduled_at).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
                <p className="text-sm text-muted dark:text-muted-dark">
                  {new Date(upcoming[0]!.scheduled_at).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {" \u00B7 "}
                  {String(upcoming[0]!.duration_minutes)} min
                  {" \u00B7 "}
                  {locationLabel[upcoming[0]!.location_type] ?? upcoming[0]!.location_type}
                </p>
              </div>
              <Link to="/my-lessons" className="text-sm text-accent hover:underline">
                All Lessons
              </Link>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-muted dark:text-muted-dark">No upcoming lessons</p>
              <Link
                to="/book-lesson"
                search={{ date: getDefaultBookingDate() }}
                className="no-underline"
              >
                <Button variant="primary" className="text-sm">
                  Book a Lesson
                </Button>
              </Link>
            </div>
          </Card>
        )}
      </section>
    </>
  );
}
