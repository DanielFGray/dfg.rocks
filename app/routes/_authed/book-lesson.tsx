import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { LocationType } from "../../lib/types.js";
import { getBookLessonPageData } from "../../lib/routeData.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Select } from "../../components/ui/Select.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";

export function getDefaultBookingDate() {
  return new Date().toISOString().slice(0, 10);
}

export const Route = createFileRoute("/_authed/book-lesson")({
  validateSearch: (search: Record<string, unknown>) => ({
    date:
      typeof search.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.date)
        ? search.date
        : getDefaultBookingDate(),
  }),
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: ({ deps }) => getBookLessonPageData({ data: { date: deps.date } }),
  head: () => ({ meta: [{ title: "Book a Lesson | DFG Portal" }] }),
  component: BookLessonPage,
  pendingComponent: () => (
    <main className="px-5 md:px-8 pt-20 pb-16 text-muted dark:text-muted-dark mx-auto max-w-[1100px]">
      Loading...
    </main>
  ),
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
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

function formatDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatConfirmDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
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
  const search = Route.useSearch();
  const { slots } = Route.useLoaderData();
  const [selectedLocation, setSelectedLocation] = useState<LocationType>("online");
  const [bookingSlot, setBookingSlot] = useState<{
    start: string;
    end: string;
  } | null>(null);

  const bookMutation = useMutation({
    mutationFn: async (slot: { start: string; end: string }) => {
      const { data, error } = await api["my-lessons"].book.post({
        scheduled_at: slot.start,
        duration_minutes: 60,
        location_type: selectedLocation,
      });
      if (error) throw error;
      if (data && "error" in data) throw data.error;
      return data;
    },
    onSuccess: () => {
      setBookingSlot(null);
      navigate({ to: "/my-lessons" });
    },
  });

  // Group slots by day for display
  const slotsByDay = new Map<string, Array<{ start: string; end: string }>>();
  if (slots) {
    slots.forEach((slot: { start: string; end: string }) => {
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
    <main data-testid="book-lesson" className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[1100px]">
      <h1 className="text-3xl font-bold tracking-tight mb-6">Book a Lesson</h1>

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

      {/* Week navigation */}
      <div className="mb-6 flex items-center justify-between">
        <Button variant="ghost" onClick={prevWeek} data-testid="prev-week">
          Previous Week
        </Button>
        <span className="text-muted dark:text-muted-dark font-medium text-sm md:text-base">
          Week of {formatWeekLabel(search.date)}
        </span>
        <Button variant="ghost" onClick={nextWeek} data-testid="next-week">
          Next Week
        </Button>
      </div>

      {/* Slots by day */}
      {slotsByDay.size === 0 ? (
        <EmptyState message="No available slots this week. Try another week." />
      ) : (
        <div className="gap-6 flex flex-col">
          {Array.from(slotsByDay.entries()).map(([dayLabel, daySlots]) => (
            <div key={dayLabel}>
              <h3 className="text-sm font-semibold text-muted dark:text-muted-dark tracking-wider mb-2 uppercase">
                {dayLabel}
              </h3>
              <div className="gap-2 flex flex-wrap">
                {daySlots.map((slot) => (
                  <button
                    key={slot.start}
                    type="button"
                    onClick={() => setBookingSlot(slot)}
                    className="px-4 py-2 rounded-lg bg-overlay/5 dark:bg-overlay-dark/5 hover:bg-accent/20 text-primary dark:text-primary-dark text-sm font-medium border-overlay/10 dark:border-overlay-dark/10 hover:border-accent/50 cursor-pointer border transition-colors"
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
        onConfirm={() => {
          if (bookingSlot) bookMutation.mutate(bookingSlot);
        }}
        onCancel={() => setBookingSlot(null)}
      />
    </main>
  );
}
