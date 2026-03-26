import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { availableSlotsQuery } from "../../lib/queries.js";
import type { LocationType } from "../../lib/types.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Select } from "../../components/ui/Select.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";

export const Route = createFileRoute("/_authed/book-lesson")({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(availableSlotsQuery(new Date().toISOString().slice(0, 10))),
  head: () => ({ meta: [{ title: "Book a Lesson | DFG Portal" }] }),
  component: BookLessonPage,
  pendingComponent: () => (
    <main className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16 text-muted">Loading...</main>
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
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedLocation, setSelectedLocation] = useState<LocationType>("online");
  const [bookingSlot, setBookingSlot] = useState<{ start: string; end: string } | null>(null);

  const { data: slots, isError } = useQuery(availableSlotsQuery(selectedDate));

  const bookMutation = useMutation({
    mutationFn: async (slot: { start: string; end: string }) => {
      const { data } = await api["my-lessons"].book.post({
        scheduled_at: slot.start,
        duration_minutes: 60,
        location_type: selectedLocation,
      });
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
    slots.forEach((slot) => {
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
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 7);
    setSelectedDate(d.toISOString().slice(0, 10));
    setBookingSlot(null);
  };

  const nextWeek = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 7);
    setSelectedDate(d.toISOString().slice(0, 10));
    setBookingSlot(null);
  };

  return (
    <main data-pwid="book-lesson" className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16">
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
          data-pwid="booking-location"
        />
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" onClick={prevWeek} data-pwid="prev-week">
          Previous Week
        </Button>
        <span className="text-muted font-medium text-sm md:text-base">
          Week of {formatWeekLabel(selectedDate)}
        </span>
        <Button variant="ghost" onClick={nextWeek} data-pwid="next-week">
          Next Week
        </Button>
      </div>

      {/* Slots by day */}
      {isError ? (
        <Card>
          <p className="text-muted">
            Unable to load available slots. Calendar may not be configured yet.
          </p>
        </Card>
      ) : slots && slotsByDay.size === 0 ? (
        <EmptyState message="No available slots this week. Try another week." />
      ) : slots ? (
        <div className="flex flex-col gap-6">
          {Array.from(slotsByDay.entries()).map(([dayLabel, daySlots]) => (
            <div key={dayLabel}>
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-2">
                {dayLabel}
              </h3>
              <div className="flex flex-wrap gap-2">
                {daySlots.map((slot) => (
                  <button
                    key={slot.start}
                    type="button"
                    onClick={() => setBookingSlot(slot)}
                    className="px-4 py-2 rounded-lg bg-white/5 hover:bg-accent/20 text-primary text-sm font-medium transition-colors cursor-pointer border border-white/10 hover:border-accent/50"
                    data-pwid="slot"
                  >
                    {formatTime(slot.start)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted">Loading available slots...</p>
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
