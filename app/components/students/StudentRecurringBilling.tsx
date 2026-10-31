import { useEffect, useState } from "react";
import { Effect } from "effect";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  BillingModel,
  LocationType,
  RecurringSchedule,
  StudentRate,
} from "../../../shared/schemas.js";
import { api } from "../../lib/api.js";
import { getErrorMessage } from "../../lib/errors.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { EmptyState } from "../ui/EmptyState.js";
import { Input } from "../ui/Input.js";
import { Modal } from "../ui/Modal.js";
import { Select } from "../ui/Select.js";
import { Switch } from "../ui/Switch.js";
import { Textarea } from "../ui/Textarea.js";
import { MonthlyPaymentModal } from "../billing/MonthlyPaymentModal.js";

const locationOptions = [
  { value: "studio", label: "Studio" },
  { value: "online", label: "Online" },
  { value: "in_person_teacher_travels", label: "In-person (teacher travels)" },
  { value: "in_person_student_travels", label: "In-person (student travels)" },
];

const billingOptions = [
  { value: "single_booking", label: "Single booking" },
  { value: "monthly_prepaid", label: "Monthly prepaid" },
];

const weekdayOptions = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "7", label: "Sunday" },
];

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatMoney(cents: number) {
  return money.format(cents / 100);
}

function dateLabel(value: string) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

function timeLabel(value: string) {
  const [hour = "0", minute = "0"] = value.split(":");
  const date = new Date(2000, 0, 1, Number(hour), Number(minute));
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function weekdayLabel(day: number) {
  return weekdayOptions.find((option) => option.value === String(day))?.label ?? `Day ${day}`;
}

function statusLabel(value?: string | null) {
  if (!value) return "Pending generation";
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {getErrorMessage(error)}
    </p>
  );
}

export function StudentRecurringBilling({ studentId }: { studentId: string }) {
  const rates = useQuery({
    queryKey: ["admin", "student-rates", studentId],
    queryFn: () => Effect.runPromise(api.admin.studentRates({ params: { studentId }, query: {} })),
  });
  const schedules = useQuery({
    queryKey: ["admin", "recurring-schedules", studentId],
    queryFn: () => Effect.runPromise(api.admin.recurringSchedules({ params: { studentId } })),
  });
  const payments = useQuery({
    queryKey: ["admin", "monthly-payments", studentId],
    queryFn: () => Effect.runPromise(api.admin.monthlyPayments({ params: { studentId } })),
  });

  const [rateOpen, setRateOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<StudentRate | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<RecurringSchedule | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const refreshRates = () => void rates.refetch();
  const refreshSchedules = () => void schedules.refetch();
  const refreshPayments = () => void payments.refetch();

  const monthlyRates = (rates.data ?? []).filter(
    (rate) => rate.billing_model === "monthly_prepaid",
  );

  return (
    <div data-testid="student-recurring-billing" className="mb-10 flex flex-col gap-10">
      <section aria-labelledby="student-rates-heading">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2
              id="student-rates-heading"
              className="text-xl font-semibold text-primary dark:text-primary-dark"
            >
              Rates
            </h2>
            <p className="mt-1 text-sm text-muted dark:text-muted-dark">
              Lesson pricing and billing model for this student.
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0 px-3 py-1.5 text-xs"
            data-testid="add-student-rate"
            onClick={() => {
              setEditingRate(null);
              setRateOpen(true);
            }}
          >
            + Add rate
          </Button>
        </div>
        {rates.isLoading ? (
          <p className="text-sm text-muted dark:text-muted-dark">Loading rates...</p>
        ) : rates.error ? (
          <ErrorMessage error={rates.error} />
        ) : rates.data?.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {rates.data.map((rate) => (
              <Card key={rate.id}>
                <div
                  data-testid="student-rate-card"
                  className="flex items-start justify-between gap-4"
                >
                  <div>
                    <p className="font-semibold text-primary dark:text-primary-dark">
                      {formatMoney(rate.rate_cents)} / {rate.lesson_duration_minutes} min
                    </p>
                    <p className="mt-1 text-sm text-muted dark:text-muted-dark">
                      {locationOptions.find((option) => option.value === rate.location_type)
                        ?.label ?? rate.location_type}
                    </p>
                    <span className="mt-3 inline-flex rounded-full bg-violet-500/15 px-2 py-1 text-xs font-medium text-violet-700 dark:text-violet-300">
                      {rate.billing_model === "monthly_prepaid"
                        ? "Monthly prepaid"
                        : "Single booking"}
                    </span>
                    {rate.notes ? (
                      <p className="mt-2 text-xs text-muted dark:text-muted-dark">{rate.notes}</p>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    data-testid={`edit-student-rate-${rate.id}`}
                    onClick={() => {
                      setEditingRate(rate);
                      setRateOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            message="No rates configured."
            action={{ label: "Add rate", onClick: () => setRateOpen(true) }}
          />
        )}
      </section>

      <section aria-labelledby="recurring-schedules-heading">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2
              id="recurring-schedules-heading"
              className="text-xl font-semibold text-primary dark:text-primary-dark"
            >
              Recurring scheduling
            </h2>
            <p className="mt-1 text-sm text-muted dark:text-muted-dark">
              Weekly lesson times use the America/Chicago time zone.
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0 px-3 py-1.5 text-xs"
            data-testid="add-recurring-schedule"
            disabled={monthlyRates.length === 0}
            onClick={() => {
              setEditingSchedule(null);
              setScheduleOpen(true);
            }}
          >
            + Add schedule
          </Button>
        </div>
        {monthlyRates.length === 0 ? (
          <p className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/8 p-3 text-sm text-amber-800 dark:text-amber-200">
            Add a monthly prepaid rate before creating a recurring schedule.
          </p>
        ) : null}
        {schedules.isLoading ? (
          <p className="text-sm text-muted dark:text-muted-dark">Loading schedules...</p>
        ) : schedules.error ? (
          <ErrorMessage error={schedules.error} />
        ) : schedules.data?.length ? (
          <div className="flex flex-col gap-3">
            {schedules.data.map((schedule) => (
              <Card key={schedule.id}>
                <div
                  data-testid="recurring-schedule-card"
                  className="flex items-start justify-between gap-4"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-primary dark:text-primary-dark">
                        {weekdayLabel(schedule.day_of_week)} at{" "}
                        {timeLabel(schedule.local_start_time)}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${schedule.active ? "bg-green-500/15 text-green-700 dark:text-green-300" : "bg-overlay/10 text-muted dark:bg-overlay-dark/10 dark:text-muted-dark"}`}
                      >
                        {schedule.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted dark:text-muted-dark">
                      {dateLabel(schedule.starts_on)}
                      {schedule.ends_on ? ` – ${dateLabel(schedule.ends_on)}` : " onward"} ·{" "}
                      {schedule.timezone}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    data-testid={`edit-recurring-schedule-${schedule.id}`}
                    onClick={() => {
                      setEditingSchedule(schedule);
                      setScheduleOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState message="No recurring schedules configured." />
        )}
      </section>

      <section aria-labelledby="monthly-payments-heading">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2
              id="monthly-payments-heading"
              className="text-xl font-semibold text-primary dark:text-primary-dark"
            >
              Monthly payments
            </h2>
            <p className="mt-1 text-sm text-muted dark:text-muted-dark">
              Record prepaid months and track lesson generation.
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0 px-3 py-1.5 text-xs"
            data-testid="record-monthly-payment"
            disabled={monthlyRates.length === 0}
            onClick={() => setPaymentOpen(true)}
          >
            + Record payment
          </Button>
        </div>
        {payments.isLoading ? (
          <p className="text-sm text-muted dark:text-muted-dark">Loading payments...</p>
        ) : payments.error ? (
          <ErrorMessage error={payments.error} />
        ) : payments.data?.length ? (
          <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
                <tr>
                  <th className="px-4 py-3 font-medium">Billing month</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Paid</th>
                  <th className="px-4 py-3 font-medium">Generation</th>
                </tr>
              </thead>
              <tbody>
                {payments.data.map((payment) => (
                  <tr
                    key={payment.id}
                    data-testid="monthly-payment-row"
                    className="border-t border-overlay/8 dark:border-overlay-dark/8"
                  >
                    <td className="px-4 py-3 font-medium text-primary dark:text-primary-dark">
                      {dateLabel(payment.billing_month)}
                    </td>
                    <td className="px-4 py-3">{formatMoney(payment.amount_cents)}</td>
                    <td className="px-4 py-3">{dateLabel(payment.paid_at)}</td>
                    <td className="px-4 py-3" data-testid="payment-generation-status">
                      {statusLabel(payment.generation_status)}
                      {payment.generation_error ? ` · ${payment.generation_error}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No monthly payments recorded." />
        )}
      </section>

      <RateModal
        studentId={studentId}
        rate={editingRate}
        open={rateOpen}
        onClose={() => setRateOpen(false)}
        onSaved={refreshRates}
      />
      <ScheduleModal
        studentId={studentId}
        rates={monthlyRates}
        schedule={editingSchedule}
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSaved={refreshSchedules}
      />
      <MonthlyPaymentModal
        studentId={studentId}
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        onSaved={() => {
          refreshPayments();
          refreshSchedules();
        }}
      />
    </div>
  );
}

function RateModal({
  studentId,
  rate,
  open,
  onClose,
  onSaved,
}: {
  studentId: string;
  rate: StudentRate | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState<LocationType>("studio");
  const [billingModel, setBillingModel] = useState<BillingModel>("single_booking");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount(rate ? (rate.rate_cents / 100).toFixed(2) : "");
    setDuration(String(rate?.lesson_duration_minutes ?? 60));
    setLocation(rate?.location_type ?? "studio");
    setBillingModel(rate?.billing_model ?? "single_booking");
    setNotes(rate?.notes ?? "");
  }, [open, rate]);

  const save = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.admin.saveStudentRate({
          payload: {
            student_id: studentId,
            rate_cents: Math.round(Number(amount) * 100),
            lesson_duration_minutes: duration === "30" ? 30 : 60,
            location_type: location,
            billing_model: billingModel,
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          },
        }),
      ),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={rate ? "Edit rate" : "Add rate"}>
      <form
        data-testid="student-rate-form"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Input
          id="rate-amount"
          name="amount"
          label="Rate amount (USD)"
          type="number"
          required
          value={amount}
          onChange={setAmount}
        />
        <Input
          id="rate-duration"
          name="duration"
          label="Lesson duration (minutes)"
          type="number"
          required
          value={duration}
          onChange={setDuration}
        />
        <Select
          id="rate-location"
          name="location_type"
          label="Location"
          options={locationOptions}
          required
          value={location}
          onChange={(value) => setLocation(value as LocationType)}
        />
        <Select
          id="rate-billing-model"
          name="billing_model"
          label="Billing model"
          options={billingOptions}
          required
          value={billingModel}
          onChange={(value) => setBillingModel(value as BillingModel)}
          data-testid="rate-billing-model"
        />
        <Textarea id="rate-notes" name="notes" label="Notes" value={notes} onChange={setNotes} />
        <ErrorMessage error={save.error} />
        <div className="mt-2 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={save.isPending || !amount || Number(amount) <= 0 || Number(duration) <= 0}
          >
            {save.isPending ? "Saving..." : "Save rate"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ScheduleModal({
  studentId,
  rates,
  schedule,
  open,
  onClose,
  onSaved,
}: {
  studentId: string;
  rates: StudentRate[];
  schedule: RecurringSchedule | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rateId, setRateId] = useState("");
  const [weekday, setWeekday] = useState("1");
  const [localTime, setLocalTime] = useState("16:00");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setRateId(schedule?.student_rate_id ?? rates[0]?.id ?? "");
    setWeekday(String(schedule?.day_of_week ?? 1));
    setLocalTime(schedule?.local_start_time.slice(0, 5) ?? "16:00");
    setStartDate(schedule?.starts_on.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
    setEndDate(schedule?.ends_on?.slice(0, 10) ?? "");
    setActive(schedule?.active ?? true);
  }, [open, rates, schedule]);

  const save = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.admin.saveRecurringSchedule({
          params: { studentId },
          payload: {
            ...(schedule ? { id: schedule.id } : {}),
            student_rate_id: rateId,
            day_of_week: Number(weekday),
            local_start_time: localTime,
            timezone: "America/Chicago",
            starts_on: startDate,
            ends_on: endDate || null,
            active,
          },
        }),
      ),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={schedule ? "Edit recurring schedule" : "Add recurring schedule"}
    >
      <form
        data-testid="recurring-schedule-form"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        {rates.length > 1 ? (
          <Select
            id="schedule-rate"
            name="student_rate_id"
            label="Monthly prepaid rate"
            options={rates.map((rate) => ({
              value: rate.id,
              label: `${formatMoney(rate.rate_cents)} / ${rate.lesson_duration_minutes} min · ${locationOptions.find((option) => option.value === rate.location_type)?.label}`,
            }))}
            required
            value={rateId}
            onChange={setRateId}
          />
        ) : null}
        <Select
          id="schedule-weekday"
          name="day_of_week"
          label="Weekday"
          options={weekdayOptions}
          required
          value={weekday}
          onChange={setWeekday}
          data-testid="schedule-weekday"
        />
        <Input
          id="schedule-time"
          name="local_start_time"
          label="Local time"
          type="time"
          required
          value={localTime}
          onChange={setLocalTime}
          data-testid="schedule-local-time"
        />
        <Input
          id="schedule-timezone"
          name="timezone"
          label="Time zone"
          value="America/Chicago"
          readOnly
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="schedule-start"
            name="starts_on"
            label="Start date"
            type="date"
            required
            value={startDate}
            onChange={setStartDate}
            data-testid="schedule-start-date"
          />
          <Input
            id="schedule-end"
            name="ends_on"
            label="End date (optional)"
            type="date"
            value={endDate}
            onChange={setEndDate}
            data-testid="schedule-end-date"
          />
        </div>
        <Switch isSelected={active} onChange={setActive} data-testid="schedule-active">
          Active
        </Switch>
        <ErrorMessage error={save.error} />
        <div className="mt-2 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || !rateId || !startDate || !localTime}>
            {save.isPending ? "Saving..." : "Save schedule"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
