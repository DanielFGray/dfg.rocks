import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { WorkingHours } from "../../lib/types.js";
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
  onRefresh,
}: {
  gcalStatus: { connected: boolean; calendar_id?: string | null };
  workingHoursData: WorkingHours;
  testimonialReminderIntervalDays: number;
  onRefresh: () => void;
}) {
  const [workingHours, setWorkingHours] = useState<WorkingHoursMap>(() =>
    workingHoursData ? toWorkingHoursMap(workingHoursData) : defaultWorkingHours,
  );
  const [intervalDays, setIntervalDays] = useState(() => String(testimonialReminderIntervalDays));

  useEffect(() => {
    setWorkingHours(workingHoursData ? toWorkingHoursMap(workingHoursData) : defaultWorkingHours);
  }, [workingHoursData]);

  useEffect(() => {
    setIntervalDays(String(testimonialReminderIntervalDays));
  }, [testimonialReminderIntervalDays]);

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.admin.gcal.disconnect.post();
      return data;
    },
    onSettled: () => {
      onRefresh();
    },
  });

  const saveHoursMutation = useMutation({
    mutationFn: async (hours: WorkingHoursMap) => {
      const { data, error } = await api.admin["working-hours"].post({
        0: hours["0"] ?? null,
        1: hours["1"] ?? null,
        2: hours["2"] ?? null,
        3: hours["3"] ?? null,
        4: hours["4"] ?? null,
        5: hours["5"] ?? null,
        6: hours["6"] ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      onRefresh();
    },
  });

  const saveReminderIntervalMutation = useMutation({
    mutationFn: async (nextIntervalDays: number) => {
      const { data, error } = await api.admin["testimonial-reminder-interval"].post({
        interval_days: nextIntervalDays,
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      onRefresh();
    },
  });

  const handleConnect = async () => {
    const { data, error } = await api.admin.gcal["auth-url"].get();
    if (error) throw error;
    if ("error" in data) throw new Error(data.error);
    window.location.href = data.url;
  };

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

  const parsedIntervalDays = Number(intervalDays);
  const canSaveInterval =
    Number.isInteger(parsedIntervalDays) &&
    parsedIntervalDays >= 1 &&
    parsedIntervalDays <= 365 &&
    parsedIntervalDays !== testimonialReminderIntervalDays &&
    !saveReminderIntervalMutation.isPending;

  return (
    <section className="mb-12" data-testid="gcal-section">
      <h2 className="text-xl font-semibold mb-4">Google Calendar</h2>

      {gcalStatus.connected ? (
        <Card>
          <div className="sm:flex-row sm:items-center sm:justify-between gap-3 flex flex-col">
            <div>
              <p className="text-primary dark:text-primary-dark font-medium">Connected</p>
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
          <div className="sm:flex-row sm:items-center sm:justify-between gap-3 flex flex-col">
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

      {/* Working Hours */}
      <h3 className="text-lg font-semibold mt-8 mb-4">Working Hours</h3>
      <div className="gap-2 flex flex-col">
        {days.map((day) => (
          <Card key={day.index}>
            <div className="sm:flex-row sm:items-center sm:justify-between gap-3 flex flex-col">
              <span className="font-medium text-primary dark:text-primary-dark w-24">
                {day.label}
              </span>
              {workingHours[day.index] ? (
                <div className="gap-2 flex flex-wrap items-center">
                  <input
                    type="time"
                    value={workingHours[day.index]!.start}
                    onChange={(e) => updateDayTime(day.index, "start", e.target.value)}
                    className="bg-surface dark:bg-surface-dark border-border rounded-sm px-2 py-1 text-sm text-primary dark:text-primary-dark border"
                    data-testid={`hours-start-${day.index}`}
                  />
                  <span className="text-muted dark:text-muted-dark">to</span>
                  <input
                    type="time"
                    value={workingHours[day.index]!.end}
                    onChange={(e) => updateDayTime(day.index, "end", e.target.value)}
                    className="bg-surface dark:bg-surface-dark border-border rounded-sm px-2 py-1 text-sm text-primary dark:text-primary-dark border"
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
                <div className="gap-2 flex items-center">
                  <span className="text-muted dark:text-muted-dark text-sm">Not working</span>
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

      <h3 className="text-lg font-semibold mt-8 mb-4">Testimonial Reminders</h3>
      <Card>
        <div className="gap-4 sm:flex-row sm:items-end sm:justify-between flex flex-col">
          <div className="flex-1">
            <p className="font-medium text-primary dark:text-primary-dark">Reminder interval</p>
            <p className="text-sm text-muted dark:text-muted-dark">
              New students and parents will see the dashboard testimonial prompt after this many
              days, and reminder emails will repeat on the same cadence until they submit one.
            </p>
          </div>
          <div className="gap-2 sm:min-w-56 flex flex-col">
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
              className="bg-surface dark:bg-surface-dark border-border rounded-sm px-3 py-2 text-sm text-primary dark:text-primary-dark border"
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
        </div>
      </Card>
    </section>
  );
}
