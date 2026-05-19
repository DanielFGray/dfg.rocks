import { Link } from "@tanstack/react-router";
import type { Message, Lesson, Material, Course, Testimonial } from "../../lib/types.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
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
  onRefresh: () => void;
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
          <div className="gap-3 flex flex-col">
            {unread.slice(0, 3).map((m) => (
              <Link key={m.id} to="/messages" className="no-underline">
                <Card>
                  <p className="text-sm text-primary dark:text-primary-dark line-clamp-2">
                    {m.body}
                  </p>
                  <p className="text-xs text-muted dark:text-muted-dark mt-1">
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
          <div className="gap-3 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
            {assignments.slice(0, 6).map((a) => (
              <Link
                key={a.id}
                to="/assignments/$materialId"
                params={{ materialId: a.id }}
                className="no-underline"
              >
                <Card>
                  <p className="font-medium text-primary dark:text-primary-dark text-sm">
                    {a.title}
                  </p>
                  <p className="text-xs text-muted dark:text-muted-dark mt-1">
                    {a.original_filename}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-8 flex items-center justify-between">
          <h2 className="text-3xl font-bold tracking-tight">My Courses</h2>
          <Link to="/courses" className="text-sm text-accent hover:underline">
            View All
          </Link>
        </div>

        {courses.length === 0 ? null : (
          <div className="gap-2 flex flex-col">
            {courses.map((course) => (
              <Link
                key={course.id}
                to="/courses/$id"
                params={{ id: course.id }}
                className="no-underline"
              >
                <Card>
                  <div className="flex items-center justify-between">
                    <span className="text-primary dark:text-primary-dark font-medium">
                      {course.title}
                    </span>
                    <span className="bg-accent/12 px-2.5 py-0.5 text-sm font-semibold text-accent rounded-full">
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
        <h2 className="text-3xl font-semibold mb-4">Next Lesson</h2>
        {upcoming.length > 0 ? (
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-primary dark:text-primary-dark font-medium">
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
