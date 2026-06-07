import { Effect } from "effect";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { Testimonial, WorkingHours } from "../../../shared/schemas.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

/* ---------------------------------------------------------------------------
 * Working hours types & constants
 * --------------------------------------------------------------------------- */

type DayHours = { start: string; end: string } | null;
type WorkingHoursMap = Record<string, DayHours>;

const days = [
  { index: "0", label: "Sunday" },
  { index: "1", label: "Monday" },
  { index: "2", label: "Tuesday" },
  { index: "3", label: "Wednesday" },
  { index: "4", label: "Thursday" },
  { index: "5", label: "Friday" },
  { index: "6", label: "Saturday" },
] as const;

const defaultWorkingHours: WorkingHoursMap = {
  "0": null,
  "1": { start: "09:00", end: "20:00" },
  "2": { start: "09:00", end: "20:00" },
  "3": { start: "09:00", end: "20:00" },
  "4": { start: "09:00", end: "20:00" },
  "5": { start: "09:00", end: "20:00" },
  "6": { start: "10:00", end: "14:00" },
};

function toWorkingHoursMap(wh: WorkingHours): WorkingHoursMap {
  const mapped: WorkingHoursMap = {};
  for (const day of days) {
    mapped[day.index] = wh[Number(day.index) as keyof WorkingHours] ?? null;
  }
  return mapped;
}

/* ---------------------------------------------------------------------------
 * AdminSection — Google Calendar + Working Hours (admin only)
 * --------------------------------------------------------------------------- */

export function AdminSection({
  gcalStatus,
  workingHoursData,
  testimonialReminderIntervalDays,
  testimonials,
  onRefresh,
}: {
  gcalStatus: { connected: boolean; calendar_id?: string | null };
  workingHoursData: WorkingHours;
  testimonialReminderIntervalDays: number;
  testimonials: Testimonial[];
  onRefresh: () => void;
}) {
  const [workingHours, setWorkingHours] = useState<WorkingHoursMap>(() =>
    workingHoursData
      ? toWorkingHoursMap(workingHoursData)
      : defaultWorkingHours,
  );
  const [intervalDays, setIntervalDays] = useState(() =>
    String(testimonialReminderIntervalDays),
  );

  useEffect(() => {
    setWorkingHours(
      workingHoursData
        ? toWorkingHoursMap(workingHoursData)
        : defaultWorkingHours,
    );
  }, [workingHoursData]);

  useEffect(() => {
    setIntervalDays(String(testimonialReminderIntervalDays));
  }, [testimonialReminderIntervalDays]);

  const disconnectMutation = useMutation({
    mutationFn: () => Effect.runPromise(api.admin.gcalDisconnect()),
    onSettled: () => {
      onRefresh();
    },
  });

  const saveHoursMutation = useMutation({
    mutationFn: (hours: WorkingHoursMap) =>
      Effect.runPromise(
        api.admin.saveWorkingHours({
          payload: {
            0: hours["0"] ?? null,
            1: hours["1"] ?? null,
            2: hours["2"] ?? null,
            3: hours["3"] ?? null,
            4: hours["4"] ?? null,
            5: hours["5"] ?? null,
            6: hours["6"] ?? null,
          },
        }),
      ),
    onSettled: () => {
      onRefresh();
    },
  });

  const saveReminderIntervalMutation = useMutation({
    mutationFn: (nextIntervalDays: number) =>
      Effect.runPromise(
        api.admin.saveTestimonialReminderInterval({
          payload: { interval_days: nextIntervalDays },
        }),
      ),
    onSettled: () => {
      onRefresh();
    },
  });
  const reviewTestimonialMutation = useMutation({
    mutationFn: ({
      testimonialId,
      isApproved,
    }: {
      testimonialId: string;
      isApproved: boolean;
    }) =>
      Effect.runPromise(
        api.admin.updateTestimonialApproval({
          path: { id: testimonialId },
          payload: { is_approved: isApproved },
        }),
      ),
    onSettled: () => {
      onRefresh();
    },
  });

  const handleConnect = () => {
    window.location.assign("/api/admin/gcal/connect");
  };

  const toggleDay = (index: string) => {
    setWorkingHours((prev) => ({
      ...prev,
      [index]: prev[index] ? null : { start: "09:00", end: "17:00" },
    }));
  };

  const updateDayTime = (
    index: string,
    field: "start" | "end",
    value: string,
  ) => {
    setWorkingHours((prev) => {
      const current = prev[index];
      if (!current) return prev;
      return { ...prev, [index]: { ...current, [field]: value } };
    });
  };

  const parsedIntervalDays = Number(intervalDays);
  const canSaveInterval =
    Number.isInteger(parsedIntervalDays) &&
    parsedIntervalDays >= 1 &&
    parsedIntervalDays <= 365 &&
    parsedIntervalDays !== testimonialReminderIntervalDays &&
    !saveReminderIntervalMutation.isPending;

  return (
    <section className="mb-12" data-testid="gcal-section">
      <h2 className="mb-4 text-xl font-semibold">Google Calendar</h2>

      {gcalStatus.connected ? (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-primary dark:text-primary-dark">
                Connected
              </p>
              <p className="text-sm text-muted dark:text-muted-dark">
                Calendar:{" "}
                {"calendar_id" in gcalStatus
                  ? (gcalStatus.calendar_id ?? "primary")
                  : "primary"}
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={() => disconnectMutation.mutate()}
              className="text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300"
              data-testid="gcal-disconnect"
            >
              Disconnect
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-muted dark:text-muted-dark">Not connected</p>
              <p className="text-sm text-muted/60 dark:text-muted-dark/60">
                Connect your Google Calendar to enable scheduling
              </p>
            </div>
            <Button
              variant="primary"
              onClick={handleConnect}
              data-testid="gcal-connect"
            >
              Connect Calendar
            </Button>
          </div>
        </Card>
      )}

      {/* Working Hours */}
      <h3 className="mt-8 mb-4 text-lg font-semibold">Working Hours</h3>
      <div className="flex flex-col gap-2">
        {days.map((day) => (
          <Card key={day.index}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="w-24 font-medium text-primary dark:text-primary-dark">
                {day.label}
              </span>
              {workingHours[day.index] ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="time"
                    value={workingHours[day.index]!.start}
                    onChange={(e) =>
                      updateDayTime(day.index, "start", e.target.value)
                    }
                    className="border-border rounded-sm border bg-surface px-2 py-1 text-sm text-primary dark:bg-surface-dark dark:text-primary-dark"
                    data-testid={`hours-start-${day.index}`}
                  />
                  <span className="text-muted dark:text-muted-dark">to</span>
                  <input
                    type="time"
                    value={workingHours[day.index]!.end}
                    onChange={(e) =>
                      updateDayTime(day.index, "end", e.target.value)
                    }
                    className="border-border rounded-sm border bg-surface px-2 py-1 text-sm text-primary dark:bg-surface-dark dark:text-primary-dark"
                    data-testid={`hours-end-${day.index}`}
                  />
                  <Button
                    variant="ghost"
                    onClick={() => toggleDay(day.index)}
                    className="text-xs text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300"
                    data-testid={`hours-off-${day.index}`}
                  >
                    Off
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted dark:text-muted-dark">
                    Not working
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() => toggleDay(day.index)}
                    className="text-xs text-green-400 hover:text-green-300"
                    data-testid={`hours-on-${day.index}`}
                  >
                    Enable
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ))}
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            onClick={() => saveHoursMutation.mutate(workingHours)}
            data-testid="save-working-hours"
          >
            Save Working Hours
          </Button>
        </div>
      </div>

      <h3 className="mt-8 mb-4 text-lg font-semibold">Testimonial Reminders</h3>
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1">
            <p className="font-medium text-primary dark:text-primary-dark">
              Reminder interval
            </p>
            <p className="text-sm text-muted dark:text-muted-dark">
              New students and parents will see the dashboard testimonial prompt
              after this many days, and reminder emails will repeat on the same
              cadence until they submit one.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:min-w-56">
            <label
              htmlFor="testimonial-reminder-interval"
              className="text-sm font-medium text-primary dark:text-primary-dark"
            >
              Days between reminders
            </label>
            <input
              id="testimonial-reminder-interval"
              type="number"
              min={1}
              max={365}
              value={intervalDays}
              onChange={(e) => setIntervalDays(e.target.value)}
              className="border-border rounded-sm border bg-surface px-3 py-2 text-sm text-primary dark:bg-surface-dark dark:text-primary-dark"
              data-testid="testimonial-reminder-interval-input"
            />
            <Button
              variant="primary"
              onClick={() =>
                saveReminderIntervalMutation.mutate(parsedIntervalDays)
              }
              disabled={!canSaveInterval}
              data-testid="save-testimonial-reminder-interval"
            >
              {saveReminderIntervalMutation.isPending
                ? "Saving..."
                : "Save Reminder Interval"}
            </Button>
          </div>
        </div>
      </Card>

      <h3 className="mt-8 mb-4 text-lg font-semibold">Testimonial Review</h3>
      <div className="flex flex-col gap-3" data-testid="testimonial-review-section">
        {testimonials.length > 0 ? (
          testimonials.map((testimonial) => {
            const isSavingReview =
              reviewTestimonialMutation.isPending &&
              reviewTestimonialMutation.variables?.testimonialId === testimonial.id;
            return (
              <Card key={testimonial.id}>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium text-primary dark:text-primary-dark">
                        {testimonial.display_name}
                      </p>
                      <p className="text-sm text-muted dark:text-muted-dark">
                        {testimonial.role_label}
                      </p>
                    </div>
                    <span className="text-sm font-medium text-muted dark:text-muted-dark">
                      {testimonial.is_approved ? "Approved" : "Pending review"}
                    </span>
                  </div>
                  <p className="text-sm text-primary dark:text-primary-dark">
                    {testimonial.body}
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted dark:text-muted-dark">
                      Updated{" "}
                      {new Date(testimonial.updated_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                    <Button
                      variant={testimonial.is_approved ? "outline" : "primary"}
                      onClick={() =>
                        reviewTestimonialMutation.mutate({
                          testimonialId: testimonial.id,
                          isApproved: !testimonial.is_approved,
                        })
                      }
                      disabled={isSavingReview}
                    >
                      {isSavingReview
                        ? "Saving..."
                        : testimonial.is_approved
                          ? "Hide from site"
                          : "Approve for site"}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })
        ) : (
          <Card>
            <p className="text-sm text-muted dark:text-muted-dark">
              No testimonials have been submitted yet.
            </p>
          </Card>
        )}
      </div>
    </section>
  );
}
