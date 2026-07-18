import { useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { CalendarDate, Time } from "@internationalized/date";
import { fieldError } from "../../lib/form.js";
import { Modal } from "../ui/Modal.js";
import { DatePicker } from "../ui/DatePicker.js";
import { TimeField } from "../ui/TimeField.js";
import { Select } from "../ui/Select.js";
import { Button } from "../ui/Button.js";
import type { LocationType } from "../../../shared/schemas.js";
import { requiredValidator, durationOptions, locationOptions } from "./helpers.js";

const requiredLocationValidator = {
  onChange: ({ value }: { value: "" | LocationType }) => (value ? undefined : "Required"),
};

function toLocalDatetime(date: CalendarDate, time: string): string {
  return `${date.toString()}T${time}:00`;
}

export function NewLessonModal({
  open,
  onClose,
  studentOptions,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  studentOptions: { value: string; label: string }[];
  onSubmit: (value: {
    student_id: string;
    scheduled_at: string;
    duration_minutes: number;
    location_type: LocationType;
  }) => void;
}) {
  const defaultValue = useMemo(() => {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    return {
      date: new CalendarDate(nextHour.getFullYear(), nextHour.getMonth() + 1, nextHour.getDate()),
      time: `${String(nextHour.getHours()).padStart(2, "0")}:${String(nextHour.getMinutes()).padStart(2, "0")}`,
    };
  }, []);

  const lessonForm = useForm({
    defaultValues: {
      student_id: "",
      time: defaultValue.time,
      duration_minutes: "60",
      location_type: "" as "" | LocationType,
    },
    onSubmit: async ({ value }) => {
      if (!value.location_type) {
        return;
      }

      onSubmit({
        student_id: value.student_id,
        scheduled_at: toLocalDatetime(dateValue ?? defaultValue.date, value.time),
        duration_minutes: Number(value.duration_minutes),
        location_type: value.location_type,
      });
    },
  });

  const [dateValue, setDateValue] = useDateValue(defaultValue.date);

  return (
    <Modal open={open} onClose={onClose} title="New Lesson">
      <form
        data-testid="lesson-form"
        onSubmit={(e) => {
          e.preventDefault();
          lessonForm.handleSubmit();
        }}
        className="flex flex-col gap-5"
      >
        <lessonForm.Field name="student_id" validators={requiredValidator}>
          {(field) => (
            <Select
              id="lesson-student"
              name="student_id"
              label="Student"
              options={studentOptions}
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              onBlur={() => field.handleBlur()}
              error={fieldError(field.state.meta.errors)}
            />
          )}
        </lessonForm.Field>

        <div className="flex gap-3">
          <div className="flex-1">
            <DatePicker
              label="Date"
              value={dateValue}
              onChange={(v) => {
                if (v instanceof CalendarDate) setDateValue(v);
              }}
              isRequired
            />
          </div>
          <lessonForm.Field name="time" validators={requiredValidator}>
            {(field) => {
              const parts = field.state.value.split(":");
              const timeValue =
                parts.length === 2 ? new Time(Number(parts[0]), Number(parts[1])) : null;
              return (
                <TimeField
                  label="Time"
                  value={timeValue}
                  onChange={(v) => {
                    if (v) {
                      field.handleChange(
                        `${v.hour.toString().padStart(2, "0")}:${v.minute.toString().padStart(2, "0")}`,
                      );
                    }
                  }}
                  error={fieldError(field.state.meta.errors)}
                  isRequired
                  data-testid="lesson-time"
                />
              );
            }}
          </lessonForm.Field>
        </div>

        <lessonForm.Field name="duration_minutes">
          {(field) => (
            <Select
              id="lesson-duration"
              name="duration_minutes"
              label="Duration"
              options={durationOptions}
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              onBlur={() => field.handleBlur()}
            />
          )}
        </lessonForm.Field>
        <lessonForm.Field name="location_type" validators={requiredLocationValidator}>
          {(field) => (
            <Select
              id="lesson-location"
              name="location_type"
              label="Location"
              options={locationOptions as Array<{ value: string; label: string }>}
              value={field.state.value}
              onChange={(v) => field.handleChange(v as "" | LocationType)}
              onBlur={() => field.handleBlur()}
              error={fieldError(field.state.meta.errors)}
            />
          )}
        </lessonForm.Field>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <lessonForm.Subscribe selector={(s) => s.canSubmit}>
            {(canSubmit) => (
              <Button
                type="submit"
                variant="primary"
                disabled={!canSubmit}
                data-testid="lesson-submit"
              >
                Schedule Lesson
              </Button>
            )}
          </lessonForm.Subscribe>
        </div>
      </form>
    </Modal>
  );
}

function useDateValue(initial: CalendarDate) {
  return useState(initial);
}
