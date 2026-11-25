import { Effect } from "effect";
import { useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { Sessions } from "../../../server/services/sessions.js";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import type { LocationType, TimeSlot } from "../../../shared/schemas.js";
import { runServerEffect } from "../../lib/serverEffect.js";
import { GoogleCalendar } from "../../../server/services/googleCalendar.js";
import { Button } from "../../components/ui/Button.js";
import { Select } from "../../components/ui/Select.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { Main } from "../../components/ui/Container.js";
import { Calendar } from "../../components/ui/Calendar.js";
import { Popover, DialogTrigger } from "react-aria-components";
import { CalendarDate } from "@internationalized/date";

export function getDefaultBookingDate() {
  return new Date().toISOString().slice(0, 10);
}

function calendarDateToMonday(calDate: CalendarDate): string {
  const jsDate = new Date(calDate.year, calDate.month - 1, calDate.day);
  const day = jsDate.getDay();
  const diff = jsDate.getDate() - day + (day === 0 ? -6 : 1);
  jsDate.setDate(diff);
  return jsDate.toISOString().slice(0, 10);
}

const getBookLessonPageData = createServerFn({ method: "GET" })
  .validator((data: unknown) => {
    const obj = data as Record<string, unknown>;
    return {
      date: typeof obj.date === "string" ? obj.date : getDefaultBookingDate(),
    };
  })
  .handler(async ({ data }) => {
    const token = getCookie("session");
    await runServerEffect(Sessions.use((sessions) => sessions.requireSession(token)));
    return runServerEffect(
      GoogleCalendar.use((googleCalendarService) =>
        googleCalendarService.getAvailableSlots({
          date: data.date,
          days: 7,
          duration: 60,
        }),
      ),
    );
  });

export const Route = createFileRoute("/_authed/book-lesson")({
  validateSearch: (search: Record<string, unknown>) => ({
    date:
      typeof search.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.date)
        ? search.date
        : getDefaultBookingDate(),
  }),
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: ({ deps }) => getBookLessonPageData({ data: deps }),
  head: () => ({ meta: [{ title: "Book a Lesson | DFG Portal" }] }),
  component: BookLessonPage,
  pendingComponent: () => <Main className="text-muted">Loading...</Main>,
});

/* ---------------------------------------------------------------------------
 * Constants
 * --------------------------------------------------------------------------- */

const locationOptions = [
  { value: "online", label: "Online" },
  { value: "studio", label: "Studio" },
  { value: "in_person_teacher_travels", label: "In-Person (Teacher Travels)" },
  { value: "in_person_student_travels", label: "In-Person (Student Travels)" },
];

/* ---------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------- */

function formatTime(value: Date): string {
  return value.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatWeekLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatDayLabel(value: Date): string {
  return value.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatConfirmDate(value: Date): string {
  return value.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/* ---------------------------------------------------------------------------
 * BookLessonPage
 * --------------------------------------------------------------------------- */

function BookLessonPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const availability = Route.useLoaderData();
  const { user, isParent, familyStudents, activeStudentId } = useAuth();
  const [selectedLocation, setSelectedLocation] = useState<LocationType>("online");
  const [selectedStudentId, setSelectedStudentId] = useState(
    activeStudentId ?? (isParent ? familyStudents[0]?.id : user?.id) ?? "",
  );
  const [bookingSlot, setBookingSlot] = useState<TimeSlot | null>(null);

  // Reset the booking when the active student changes. Only the id is compared, so an
  // auth refetch that returns a new familyStudents array does not clear a chosen slot.
  const [trackedActiveStudentId, setTrackedActiveStudentId] = useState(activeStudentId);
  if (trackedActiveStudentId !== activeStudentId) {
    setTrackedActiveStudentId(activeStudentId);
    setSelectedStudentId(activeStudentId ?? (isParent ? familyStudents[0]?.id : user?.id) ?? "");
    setBookingSlot(null);
  }

  const bookMutation = useMutation({
    mutationFn: (slot: TimeSlot) =>
      Effect.runPromise(
        api.lessons.bookLesson({
          payload: {
            scheduled_at: slot.start,
            duration_minutes: 60,
            location_type: selectedLocation,
            student_id: selectedStudentId || undefined,
          },
        }),
      ),
    onSuccess: () => {
      void router.invalidate();
      setBookingSlot(null);
      navigate({ to: "/my-lessons" });
    },
  });

  // Group slots by day for display
  const slotsByDay = new Map<string, Array<TimeSlot>>();
  if (availability._tag === "Slots") {
    availability.slots.forEach((slot) => {
      const dayKey = formatDayLabel(slot.start);
      const existing = slotsByDay.get(dayKey);
      if (existing) {
        existing.push(slot);
      } else {
        slotsByDay.set(dayKey, [slot]);
      }
    });
  }

  const prevWeek = () => {
    const d = new Date(search.date);
    d.setDate(d.getDate() - 7);
    navigate({
      to: "/book-lesson",
      search: { date: d.toISOString().slice(0, 10) },
      replace: true,
    });
    setBookingSlot(null);
  };

  const nextWeek = () => {
    const d = new Date(search.date);
    d.setDate(d.getDate() + 7);
    navigate({
      to: "/book-lesson",
      search: { date: d.toISOString().slice(0, 10) },
      replace: true,
    });
    setBookingSlot(null);
  };

  return (
    <Main data-testid="book-lesson">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">Book a Lesson</h1>

      {availability._tag === "CalendarNotConnected" ? (
        <EmptyState message="Online booking is unavailable right now. Please contact your teacher to book a lesson." />
      ) : (
        <>
          {/* Location type selector */}
          <div className="mb-6">
            <Select
              id="booking-location"
              name="location_type"
              label="Lesson Type"
              options={locationOptions}
              value={selectedLocation}
              onChange={(v) => setSelectedLocation(v as LocationType)}
              data-testid="booking-location"
            />
          </div>

          {/* Student selector for parents */}
          {isParent && familyStudents.length > 0 ? (
            <div className="mb-6">
              <Select
                id="booking-student"
                name="student_id"
                label="Book for"
                options={[
                  ...familyStudents.map((s) => ({
                    value: s.id,
                    label: s.name || s.username,
                  })),
                ]}
                value={selectedStudentId}
                onChange={setSelectedStudentId}
                data-testid="booking-student"
              />
            </div>
          ) : null}

          {/* Week navigation */}
          <div className="mb-6 flex items-center justify-between gap-4">
            <Button variant="ghost" onClick={prevWeek} data-testid="prev-week">
              Previous Week
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted md:text-base">
                Week of {formatWeekLabel(search.date)}
              </span>
              <DialogTrigger>
                <Button variant="ghost" size="icon" aria-label="Pick a date">
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </Button>
                <Popover className="rounded-xl border border-overlay/10 bg-card p-4 shadow-2xl">
                  <Calendar
                    value={null}
                    onChange={(date) => {
                      const monday = calendarDateToMonday(date);
                      navigate({
                        to: "/book-lesson",
                        search: { date: monday },
                        replace: true,
                      });
                      setBookingSlot(null);
                    }}
                  />
                </Popover>
              </DialogTrigger>
            </div>
            <Button variant="ghost" onClick={nextWeek} data-testid="next-week">
              Next Week
            </Button>
          </div>

          {/* Slots by day */}
          {slotsByDay.size === 0 ? (
            <EmptyState message="No available slots this week. Try another week." />
          ) : (
            <div className="flex flex-col gap-6">
              {Array.from(slotsByDay.entries()).map(([dayLabel, daySlots]) => (
                <div key={dayLabel}>
                  <h3 className="mb-2 text-sm font-semibold tracking-wider text-muted uppercase">
                    {dayLabel}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {daySlots.map((slot) => (
                      <button
                        key={slot.start.toISOString()}
                        type="button"
                        onClick={() => setBookingSlot(slot)}
                        className="cursor-pointer rounded-lg border border-overlay/10 bg-overlay/5 px-4 py-2 text-sm font-medium text-primary transition-colors hover:border-accent/50 hover:bg-accent/20"
                        data-testid="slot"
                      >
                        {formatTime(slot.start)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Booking confirmation dialog */}
          <ConfirmDialog
            open={bookingSlot !== null}
            title="Confirm Booking"
            message={
              bookingSlot
                ? `Book a lesson on ${formatConfirmDate(bookingSlot.start)} at ${formatTime(bookingSlot.start)}?`
                : ""
            }
            confirmLabel="Book Lesson"
            variant="default"
            onConfirm={async () => {
              if (bookingSlot) await bookMutation.mutateAsync(bookingSlot);
            }}
            onCancel={() => setBookingSlot(null)}
          />
        </>
      )}
    </Main>
  );
}
