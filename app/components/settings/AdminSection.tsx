import { Effect } from "effect";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { Testimonial, WorkingHours } from "../../../shared/schemas.js";
import { defaultWorkingHours } from "../../../shared/workingHours.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Input } from "../ui/Input.js";
import { TimeField } from "../ui/TimeField.js";
import { Time } from "@internationalized/date";

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
  onRefresh: () => Promise<void>;
}) {
  const policyQuery = useQuery({
    queryKey: ["admin", "cancellation-policy"],
    queryFn: () => Effect.runPromise(api.lessonsAdmin.cancellationPolicySettings()),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => Effect.runPromise(api.calendarAdmin.gcalDisconnect()),
    onSuccess: onRefresh,
  });

  const reviewTestimonialMutation = useMutation({
    mutationFn: ({ testimonialId, isApproved }: { testimonialId: string; isApproved: boolean }) =>
      Effect.runPromise(
        api.testimonialsAdmin.updateTestimonialApproval({
          params: { id: testimonialId },
          payload: { is_approved: isApproved },
        }),
      ),
    onSuccess: onRefresh,
  });

  const handleConnect = () => {
    window.location.assign("/api/admin/gcal/connect");
  };

  return (
    <section className="mb-12" data-testid="gcal-section">
      <h2 className="mb-4 text-xl font-semibold">Google Calendar</h2>

      {gcalStatus.connected ? (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-primary dark:text-primary-dark">Connected</p>
              <p className="text-sm text-muted dark:text-muted-dark">
                Calendar:{" "}
                {"calendar_id" in gcalStatus ? (gcalStatus.calendar_id ?? "primary") : "primary"}
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
            <Button variant="primary" onClick={handleConnect} data-testid="gcal-connect">
              Connect Calendar
            </Button>
          </div>
        </Card>
      )}

      <WorkingHoursForm saved={workingHoursData} onRefresh={onRefresh} />

      {/* Cancellation Policy */}
      <h3 className="mt-8 mb-4 text-lg font-semibold">Cancellation Policy</h3>
      <Card>
        {policyQuery.isLoading ? (
          <p className="text-sm text-muted dark:text-muted-dark">Loading...</p>
        ) : policyQuery.error ? (
          <p className="text-sm text-red-500">Failed to load cancellation policy settings.</p>
        ) : policyQuery.data ? (
          <CancellationPolicyForm saved={policyQuery.data} />
        ) : null}
      </Card>

      <h3 className="mt-8 mb-4 text-lg font-semibold">Testimonial Reminders</h3>
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1">
            <p className="font-medium text-primary dark:text-primary-dark">Reminder interval</p>
            <p className="text-sm text-muted dark:text-muted-dark">
              New students and parents will see the dashboard testimonial prompt after this many
              days, and reminder emails will repeat on the same cadence until they submit one.
            </p>
          </div>
          <ReminderIntervalForm saved={testimonialReminderIntervalDays} onRefresh={onRefresh} />
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
              <Card key={testimonial.id} data-testid="testimonial-review-card">
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
                  <p className="text-sm text-primary dark:text-primary-dark">{testimonial.body}</p>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted dark:text-muted-dark">
                      Updated{" "}
                      {testimonial.updated_at.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                    <Button
                      variant={testimonial.is_approved ? "outline" : "primary"}
                      data-testid="approve-testimonial"
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

/** Starts from the saved hours; a refresh of the page data leaves the edits alone. */
function WorkingHoursForm({
  saved,
  onRefresh,
}: {
  saved: WorkingHours;
  onRefresh: () => Promise<void>;
}) {
  const [workingHours, setWorkingHours] = useState<WorkingHoursMap>(() =>
    toWorkingHoursMap(saved ?? defaultWorkingHours),
  );
  const saveHoursMutation = useMutation({
    mutationFn: (hours: WorkingHoursMap) =>
      Effect.runPromise(
        api.lessonsAdmin.saveWorkingHours({
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
    onSuccess: onRefresh,
  });

  const toggleDay = (index: string) => {
    setWorkingHours((prev) => ({
      ...prev,
      [index]: prev[index] ? null : { start: "09:00", end: "17:00" },
    }));
  };

  const updateDayTime = (index: string, field: "start" | "end", value: string) => {
    setWorkingHours((prev) => {
      const current = prev[index];
      if (!current) return prev;
      return { ...prev, [index]: { ...current, [field]: value } };
    });
  };

  return (
    <>
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
                  <TimeField
                    label="Start"
                    value={
                      workingHours[day.index]!.start
                        ? new Time(
                            Number(workingHours[day.index]!.start.split(":")[0]),
                            Number(workingHours[day.index]!.start.split(":")[1]),
                          )
                        : null
                    }
                    onChange={(v) => {
                      if (v)
                        updateDayTime(
                          day.index,
                          "start",
                          `${String(v.hour).padStart(2, "0")}:${String(v.minute).padStart(2, "0")}`,
                        );
                    }}
                    data-testid={`hours-start-${day.index}`}
                  />
                  <span className="text-muted dark:text-muted-dark">to</span>
                  <TimeField
                    label="End"
                    value={
                      workingHours[day.index]!.end
                        ? new Time(
                            Number(workingHours[day.index]!.end.split(":")[0]),
                            Number(workingHours[day.index]!.end.split(":")[1]),
                          )
                        : null
                    }
                    onChange={(v) => {
                      if (v)
                        updateDayTime(
                          day.index,
                          "end",
                          `${String(v.hour).padStart(2, "0")}:${String(v.minute).padStart(2, "0")}`,
                        );
                    }}
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
                  <span className="text-sm text-muted dark:text-muted-dark">Not working</span>
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
    </>
  );
}

/** Rendered once the policy has loaded, so it starts from the saved values. */
function CancellationPolicyForm({
  saved,
}: {
  saved: { cancellation_window_hours: number; late_cancel_charge_percent: number };
}) {
  const queryClient = useQueryClient();
  const [policyWindowHours, setPolicyWindowHours] = useState(
    String(saved.cancellation_window_hours),
  );
  const [policyChargePercent, setPolicyChargePercent] = useState(
    String(saved.late_cancel_charge_percent),
  );
  const savePolicyMutation = useMutation({
    mutationFn: (payload: {
      cancellation_window_hours: number;
      late_cancel_charge_percent: number;
    }) => Effect.runPromise(api.lessonsAdmin.saveCancellationPolicySettings({ payload })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "cancellation-policy"] }),
  });

  const parsedWindowHours = Number(policyWindowHours);
  const parsedChargePercent = Number(policyChargePercent);
  const canSavePolicy =
    Number.isInteger(parsedWindowHours) &&
    parsedWindowHours >= 0 &&
    parsedWindowHours <= 720 &&
    Number.isInteger(parsedChargePercent) &&
    parsedChargePercent >= 0 &&
    parsedChargePercent <= 100 &&
    (parsedWindowHours !== saved.cancellation_window_hours ||
      parsedChargePercent !== saved.late_cancel_charge_percent) &&
    !savePolicyMutation.isPending;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <Input
          id="cancellation-window-hours"
          name="cancellation_window_hours"
          label="Cancellation window (hours)"
          type="number"
          placeholder="24"
          value={policyWindowHours}
          onChange={setPolicyWindowHours}
          data-testid="policy-window-hours-input"
        />
        <Input
          id="late-cancel-charge-percent"
          name="late_cancel_charge_percent"
          label="Late cancel charge (%)"
          type="number"
          placeholder="50"
          value={policyChargePercent}
          onChange={setPolicyChargePercent}
          data-testid="policy-charge-percent-input"
        />
      </div>
      <Button
        variant="primary"
        onClick={() =>
          savePolicyMutation.mutate({
            cancellation_window_hours: parsedWindowHours,
            late_cancel_charge_percent: parsedChargePercent,
          })
        }
        disabled={!canSavePolicy}
        data-testid="save-cancellation-policy"
      >
        {savePolicyMutation.isPending ? "Saving..." : "Save Policy"}
      </Button>
    </div>
  );
}

/** Starts from the saved interval; a refresh of the page data leaves the edit alone. */
function ReminderIntervalForm({
  saved,
  onRefresh,
}: {
  saved: number;
  onRefresh: () => Promise<void>;
}) {
  const [intervalDays, setIntervalDays] = useState(String(saved));
  const saveReminderIntervalMutation = useMutation({
    mutationFn: (nextIntervalDays: number) =>
      Effect.runPromise(
        api.testimonialsAdmin.saveTestimonialReminderInterval({
          payload: { interval_days: nextIntervalDays },
        }),
      ),
    onSuccess: onRefresh,
  });

  const parsedIntervalDays = Number(intervalDays);
  const canSaveInterval =
    Number.isInteger(parsedIntervalDays) &&
    parsedIntervalDays >= 1 &&
    parsedIntervalDays <= 365 &&
    parsedIntervalDays !== saved &&
    !saveReminderIntervalMutation.isPending;

  return (
    <div className="flex flex-col gap-2 sm:min-w-56">
      <Input
        id="testimonial-reminder-interval"
        name="testimonial-reminder-interval"
        label="Days between reminders"
        type="number"
        value={intervalDays}
        onChange={setIntervalDays}
        data-testid="testimonial-reminder-interval-input"
      />
      <Button
        variant="primary"
        onClick={() => saveReminderIntervalMutation.mutate(parsedIntervalDays)}
        disabled={!canSaveInterval}
        data-testid="save-testimonial-reminder-interval"
      >
        {saveReminderIntervalMutation.isPending ? "Saving..." : "Save Reminder Interval"}
      </Button>
    </div>
  );
}
