import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { gcalStatusQuery, workingHoursQuery, unwrap } from "../../lib/queries.js";
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
  for (let i = 0; i <= 6; i++) {
    mapped[String(i)] = wh[i as keyof WorkingHours] ?? null;
  }
  return mapped;
}

/* ---------------------------------------------------------------------------
 * AdminSection — Google Calendar + Working Hours (admin only)
 * --------------------------------------------------------------------------- */

export function AdminSection() {
  const queryClient = useQueryClient();

  const { data: gcalStatus } = useSuspenseQuery(gcalStatusQuery);

  const { data: workingHoursData } = useSuspenseQuery(workingHoursQuery);

  const [workingHours, setWorkingHours] = useState<WorkingHoursMap>(() =>
    workingHoursData ? toWorkingHoursMap(workingHoursData as WorkingHours) : defaultWorkingHours,
  );

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.admin.gcal.disconnect.post();
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["gcal-status"] });
    },
  });

  const saveHoursMutation = useMutation({
    mutationFn: async (hours: WorkingHoursMap) => {
      return unwrap((await api.admin["working-hours"].post({
        0: hours["0"] ?? null,
        1: hours["1"] ?? null,
        2: hours["2"] ?? null,
        3: hours["3"] ?? null,
        4: hours["4"] ?? null,
        5: hours["5"] ?? null,
        6: hours["6"] ?? null,
      } as WorkingHours)).data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["working-hours"] });
    },
  });

  const handleConnect = async () => {
    const data = unwrap((await api.admin.gcal["auth-url"].get()).data);
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

  return (
    <section className="mb-12" data-pwid="gcal-section">
      <h2 className="text-xl font-semibold mb-4">Google Calendar</h2>

      {gcalStatus.connected ? (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-primary font-medium">Connected</p>
              <p className="text-sm text-muted">Calendar: {"calendar_id" in gcalStatus ? gcalStatus.calendar_id ?? "primary" : "primary"}</p>
            </div>
            <Button
              variant="ghost"
              onClick={() => disconnectMutation.mutate()}
              className="text-red-400 hover:text-red-300"
              data-pwid="gcal-disconnect"
            >
              Disconnect
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-muted">Not connected</p>
              <p className="text-sm text-muted/60">Connect your Google Calendar to enable scheduling</p>
            </div>
            <Button
              variant="primary"
              onClick={handleConnect}
              data-pwid="gcal-connect"
            >
              Connect Calendar
            </Button>
          </div>
        </Card>
      )}

      {/* Working Hours */}
      <h3 className="text-lg font-semibold mt-8 mb-4">Working Hours</h3>
      <div className="flex flex-col gap-2">
        {days.map((day) => (
          <Card key={day.index}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span className="font-medium text-primary w-24">{day.label}</span>
              {workingHours[day.index] ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="time"
                    value={workingHours[day.index]!.start}
                    onChange={(e) => updateDayTime(day.index, "start", e.target.value)}
                    className="bg-surface border border-border rounded px-2 py-1 text-sm text-primary"
                    data-pwid={`hours-start-${day.index}`}
                  />
                  <span className="text-muted">to</span>
                  <input
                    type="time"
                    value={workingHours[day.index]!.end}
                    onChange={(e) => updateDayTime(day.index, "end", e.target.value)}
                    className="bg-surface border border-border rounded px-2 py-1 text-sm text-primary"
                    data-pwid={`hours-end-${day.index}`}
                  />
                  <Button
                    variant="ghost"
                    onClick={() => toggleDay(day.index)}
                    className="text-xs text-red-400 hover:text-red-300"
                    data-pwid={`hours-off-${day.index}`}
                  >
                    Off
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-muted text-sm">Not working</span>
                  <Button
                    variant="ghost"
                    onClick={() => toggleDay(day.index)}
                    className="text-xs text-green-400 hover:text-green-300"
                    data-pwid={`hours-on-${day.index}`}
                  >
                    Enable
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ))}
        <div className="flex justify-end mt-4">
          <Button
            variant="primary"
            onClick={() => saveHoursMutation.mutate(workingHours)}
            data-pwid="save-working-hours"
          >
            Save Working Hours
          </Button>
        </div>
      </div>
    </section>
  );
}
