import { useForm } from "@tanstack/react-form";
import { fieldError } from "../../lib/form.js";
import { Modal } from "../ui/Modal.js";
import { Input } from "../ui/Input.js";
import { Select } from "../ui/Select.js";
import { Button } from "../ui/Button.js";
import type { LocationType } from "../../../shared/schemas.js";
import {
  requiredValidator,
  durationOptions,
  locationOptions,
} from "./helpers.js";

const requiredLocationValidator = {
  onChange: ({ value }: { value: "" | LocationType }) =>
    value ? undefined : "Required",
};

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
  const lessonForm = useForm({
    defaultValues: {
      student_id: "",
      scheduled_at: "",
      duration_minutes: "60",
      location_type: "" as "" | LocationType,
    },
    onSubmit: async ({ value }) => {
      if (!value.location_type) {
        return;
      }

      onSubmit({
        student_id: value.student_id,
        scheduled_at: value.scheduled_at,
        duration_minutes: Number(value.duration_minutes),
        location_type: value.location_type,
      });
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="New Lesson">
      <form
        data-testid="lesson-form"
        onSubmit={(e) => {
          e.preventDefault();
          lessonForm.handleSubmit();
        }}
        className="gap-5 flex flex-col"
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
        <lessonForm.Field name="scheduled_at" validators={requiredValidator}>
          {(field) => (
            <Input
              id="lesson-scheduled-at"
              name="scheduled_at"
              label="Date & Time"
              type="datetime-local"
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              onBlur={() => field.handleBlur()}
              error={fieldError(field.state.meta.errors)}
            />
          )}
        </lessonForm.Field>
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
        <lessonForm.Field
          name="location_type"
          validators={requiredLocationValidator}
        >
          {(field) => (
            <Select
              id="lesson-location"
              name="location_type"
              label="Location"
              options={
                locationOptions as Array<{ value: string; label: string }>
              }
              value={field.state.value}
              onChange={(v) => field.handleChange(v as "" | LocationType)}
              onBlur={() => field.handleBlur()}
              error={fieldError(field.state.meta.errors)}
            />
          )}
        </lessonForm.Field>
        <div className="gap-3 pt-2 flex justify-end">
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
