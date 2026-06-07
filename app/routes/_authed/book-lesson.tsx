import { Effect } from "effect";
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { availableSlotsQuery, myLessonsQuery } from "../../lib/queries.js";
import type { LocationType } from "../../../shared/schemas.js";
import { Button } from "../../components/ui/Button.js";
import { Select } from "../../components/ui/Select.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { Main } from "../../components/ui/Container.js";

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
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(availableSlotsQuery(deps.date)),
  head: () => ({ meta: [{ title: "Book a Lesson | DFG Portal" }] }),
  component: BookLessonPage,
  pendingComponent: () => (
    <Main className="text-muted dark:text-muted-dark">Loading...</Main>
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
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const { data: slots } = useSuspenseQuery(availableSlotsQuery(search.date));
  const [selectedLocation, setSelectedLocation] =
    useState<LocationType>("online");
  const [bookingSlot, setBookingSlot] = useState<{
    start: string;
    end: string;
  } | null>(null);

  const bookMutation = useMutation({
    mutationFn: (slot: { start: string; end: string }) =>
      Effect.runPromise(
        api.authenticated.bookLesson({
          payload: {
            scheduled_at: slot.start,
            duration_minutes: 60,
            location_type: selectedLocation,
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: availableSlotsQuery(search.date).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: myLessonsQuery.queryKey,
      });
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
    <Main data-testid="book-lesson">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">Book a Lesson</h1>

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
        <span className="text-sm font-medium text-muted md:text-base dark:text-muted-dark">
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
        <div className="flex flex-col gap-6">
          {Array.from(slotsByDay.entries()).map(([dayLabel, daySlots]) => (
            <div key={dayLabel}>
              <h3 className="mb-2 text-sm font-semibold tracking-wider text-muted uppercase dark:text-muted-dark">
                {dayLabel}
              </h3>
              <div className="flex flex-wrap gap-2">
                {daySlots.map((slot) => (
                  <button
                    key={slot.start}
                    type="button"
                    onClick={() => setBookingSlot(slot)}
                    className="cursor-pointer rounded-lg border border-overlay/10 bg-overlay/5 px-4 py-2 text-sm font-medium text-primary transition-colors hover:border-accent/50 hover:bg-accent/20 dark:border-overlay-dark/10 dark:bg-overlay-dark/5 dark:text-primary-dark"
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
    </Main>
  );
}
