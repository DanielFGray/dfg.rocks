import { useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { CalendarDate, Time } from "@internationalized/date";
import { fieldError } from "../../lib/form.js";
import { getErrorMessage } from "../../lib/errors.js";
import { Modal } from "../ui/Modal.js";
import { DatePicker } from "../ui/DatePicker.js";
import { TimeField } from "../ui/TimeField.js";
import { Select } from "../ui/Select.js";
import { Button } from "../ui/Button.js";
import type { Lesson, LocationType } from "../../../shared/schemas.js";
import { localInstant, requiredValidator, durationOptions, locationOptions } from "./helpers.js";

const requiredLocationValidator = {
  onChange: ({ value }: { value: "" | LocationType }) => (value ? undefined : "Required"),
};

export function EditLessonModal({
  open,
  onClose,
  lesson,
  studentOptions,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  lesson: Lesson;
  studentOptions: { value: string; label: string }[];
  /** Awaited contract: the modal stays open with its controls disabled until the promise settles. */
  onSubmit: (value: {
    scheduled_at?: Date;
    duration_minutes?: number;
    location_type?: LocationType;
  }) => Promise<void>;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const initialDateTime = useMemo(() => {
    const d = lesson.scheduled_at;
    return {
      date: new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate()),
      time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    };
  }, [lesson.scheduled_at]);

  const [dateValue, setDateValue] = useState(initialDateTime.date);

  const editForm = useForm({
    defaultValues: {
      time: initialDateTime.time,
      duration_minutes: String(lesson.duration_minutes),
      location_type: lesson.location_type as "" | LocationType,
    },
    onSubmit: async ({ value }) => {
      const payload: {
        scheduled_at?: Date;
        duration_minutes?: number;
        location_type?: LocationType;
      } = {};

      const newTime = value.time;
      const newDuration = Number(value.duration_minutes);
      const newLocation = value.location_type || undefined;

      const scheduledAt = localInstant(dateValue, newTime);
      if (scheduledAt.getTime() !== lesson.scheduled_at.getTime()) {
        payload.scheduled_at = scheduledAt;
      }
      if (newDuration !== lesson.duration_minutes) {
        payload.duration_minutes = newDuration;
      }
      if (newLocation !== lesson.location_type) {
        payload.location_type = newLocation;
      }

      if (Object.keys(payload).length === 0) {
        return;
      }

      setSubmitError(null);
      try {
        await onSubmit(payload);
      } catch (cause) {
        setSubmitError(getErrorMessage(cause, "Could not save the lesson"));
      }
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Lesson"
      isDismissable={!editForm.state.isSubmitting}
    >
      <form
        data-testid="edit-lesson-form"
        onSubmit={(e) => {
          e.preventDefault();
          editForm.handleSubmit();
        }}
        className="flex flex-col gap-5"
      >
        {/* Student is read-only in edit mode */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-muted">Student</label>
          <p className="text-sm text-primary">
            {studentOptions.find((s) => s.value === lesson.student_id)?.label ?? "Unknown"}
          </p>
        </div>

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
          <editForm.Field name="time" validators={requiredValidator}>
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
                  data-testid="edit-lesson-time"
                />
              );
            }}
          </editForm.Field>
        </div>

        <editForm.Field name="duration_minutes">
          {(field) => (
            <Select
              id="edit-lesson-duration"
              name="duration_minutes"
              label="Duration"
              options={durationOptions}
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              onBlur={() => field.handleBlur()}
            />
          )}
        </editForm.Field>

        <editForm.Field name="location_type" validators={requiredLocationValidator}>
          {(field) => (
            <Select
              id="edit-lesson-location"
              name="location_type"
              label="Location"
              options={locationOptions as Array<{ value: string; label: string }>}
              value={field.state.value}
              onChange={(v) => field.handleChange(v as "" | LocationType)}
              onBlur={() => field.handleBlur()}
              error={fieldError(field.state.meta.errors)}
            />
          )}
        </editForm.Field>

        {submitError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {submitError}
          </p>
        ) : null}
        <div className="flex justify-end gap-3 pt-2">
          <editForm.Subscribe selector={(s) => s.isSubmitting}>
            {(submitting) => (
              <Button variant="ghost" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
            )}
          </editForm.Subscribe>
          <editForm.Subscribe selector={(s) => !s.canSubmit || s.isSubmitting}>
            {(blocked) => (
              <Button
                type="submit"
                variant="primary"
                disabled={blocked}
                data-testid="edit-lesson-submit"
              >
                {editForm.state.isSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            )}
          </editForm.Subscribe>
        </div>
      </form>
    </Modal>
  );
}
