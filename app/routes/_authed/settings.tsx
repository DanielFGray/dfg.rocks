import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { UserEmail, WorkingHours } from "../../lib/types.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Input } from "../../components/ui/Input.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";

const myEmailsQuery = queryOptions({
  queryKey: ["my-emails"],
  queryFn: async () => {
    const { data, error } = await api.me.emails.get();
    if (error) throw error;
    return data;
  },
});

const gcalStatusQuery = queryOptions({
  queryKey: ["gcal-status"],
  queryFn: async () => {
    const { data, error } = await api.admin.gcal.status.get();
    if (error) throw error;
    return data;
  },
});

const workingHoursQuery = queryOptions({
  queryKey: ["working-hours"],
  queryFn: async () => {
    const { data, error } = await api.admin["working-hours"].get();
    if (error) throw error;
    return data;
  },
});

export const Route = createFileRoute("/_authed/settings")({
  loader: ({ context }) => context.queryClient.ensureQueryData(myEmailsQuery),
  head: () => ({ meta: [{ title: "Settings | DFG Portal" }] }),
  component: SettingsPage,
  pendingComponent: () => (
    <main className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16 text-muted">Loading...</main>
  ),
});

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

function AdminSection() {
  const queryClient = useQueryClient();

  const { data: gcalStatus } = useSuspenseQuery(gcalStatusQuery);

  const { data: workingHoursData } = useSuspenseQuery(workingHoursQuery);

  const [workingHours, setWorkingHours] = useState<WorkingHoursMap>(() =>
    workingHoursData ? toWorkingHoursMap(workingHoursData) : defaultWorkingHours,
  );

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.admin.gcal.disconnect.post();
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["gcal-status"] });
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
      } as WorkingHours);
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["working-hours"] });
    },
  });

  const handleConnect = async () => {
    const { data, error } = await api.admin.gcal["auth-url"].get();
    if (error) throw error;
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
              <p className="text-sm text-muted">Calendar: {gcalStatus.calendar_id ?? "primary"}</p>
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

/* ---------------------------------------------------------------------------
 * SettingsPage
 * --------------------------------------------------------------------------- */

function SettingsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const [newEmail, setNewEmail] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UserEmail | null>(null);

  const { data: emails } = useSuspenseQuery(myEmailsQuery);

  const addEmailMutation = useMutation({
    mutationFn: async (email: string) => {
      const { data, error } = await api.me.emails.post({ email });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["my-emails"] });
    },
  });

  const makePrimaryMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.me.emails[id]["make-primary"].post();
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["my-emails"] });
    },
  });

  const resendVerificationMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.me.emails[id]["resend-verification"].post();
      if (error) throw error;
      return data;
    },
  });

  const deleteEmailMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.me.emails[id].delete();
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["my-emails"] });
    },
  });

  const handleAddEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    addEmailMutation.mutate(newEmail);
    setNewEmail("");
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteEmailMutation.mutate(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <main data-pwid="settings" className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16">
      <h1 className="text-3xl font-bold tracking-tight mb-8">Account Settings</h1>

      {/* Google Calendar + Working Hours section (admin only) */}
      {isAdmin ? <AdminSection /> : null}

      {/* Email Addresses section */}
      <section data-pwid="email-section">
        <h2 className="text-xl font-semibold mb-4">Email Addresses</h2>

        <div className="flex flex-col gap-3 mb-6">
          {(emails as UserEmail[]).map((em) => (
            <Card key={em.id}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-primary break-all">{em.email}</span>
                    {em.is_primary ? (
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-accent/20 text-accent">
                        Primary
                      </span>
                    ) : null}
                    {em.is_verified ? (
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-green-500/20 text-green-400">
                        Verified
                      </span>
                    ) : (
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-500/20 text-amber-400">
                        Unverified
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 shrink-0 flex-wrap">
                  {em.is_verified && !em.is_primary ? (
                    <Button
                      variant="ghost"
                      onClick={() => makePrimaryMutation.mutate(em.id)}
                      className="text-xs px-3 py-1.5"
                      data-pwid="make-primary"
                    >
                      Make Primary
                    </Button>
                  ) : null}
                  {!em.is_verified ? (
                    <Button
                      variant="ghost"
                      onClick={() => resendVerificationMutation.mutate(em.id)}
                      className="text-xs px-3 py-1.5 text-amber-400 hover:text-amber-300"
                      data-pwid="resend-verification"
                    >
                      Resend Verification
                    </Button>
                  ) : null}
                  {!em.is_primary ? (
                    <Button
                      variant="ghost"
                      onClick={() => setDeleteTarget(em)}
                      className="text-xs px-3 py-1.5 text-red-400 hover:text-red-300"
                      data-pwid="remove-email"
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Add email form */}
        <Card>
          <form onSubmit={handleAddEmail} className="flex flex-col sm:flex-row gap-3 items-end" data-pwid="add-email-form">
            <div className="flex-1 w-full">
              <Input
                id="new-email"
                name="email"
                label="Add Email Address"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="you@example.com"
                data-pwid="new-email-input"
              />
            </div>
            <Button type="submit" variant="outline" data-pwid="add-email-btn">
              Add Email
            </Button>
          </form>
        </Card>
      </section>

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Remove Email"
        message={
          deleteTarget
            ? `Remove ${deleteTarget.email} from your account?`
            : ""
        }
        confirmLabel="Remove"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </main>
  );
}
