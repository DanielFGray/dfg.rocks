import { useForm } from "@tanstack/react-form";
import { Modal } from "../ui/Modal.js";
import { Input } from "../ui/Input.js";
import { Select } from "../ui/Select.js";
import { Button } from "../ui/Button.js";
import type { LocationType } from "../../lib/types.js";
import { requiredValidator, durationOptions, locationOptions } from "./helpers.js";

export function NewLessonModal({ open, onClose, studentOptions, onSubmit }: {
  open: boolean;
  onClose: () => void;
  studentOptions: { value: string; label: string }[];
  onSubmit: (value: { student_id: string; scheduled_at: string; duration_minutes: number; location_type: LocationType }) => void;
}) {
  const lessonForm = useForm({
    defaultValues: {
      student_id: "",
      scheduled_at: "",
      duration_minutes: "60",
      location_type: "",
    },
    onSubmit: async ({ value }) => {
      onSubmit({
        student_id: value.student_id,
        scheduled_at: value.scheduled_at,
        duration_minutes: Number(value.duration_minutes),
        location_type: value.location_type as LocationType,
      });
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="New Lesson">
      <form
        data-pwid="lesson-form"
        onSubmit={(e) => { e.preventDefault(); lessonForm.handleSubmit(); }}
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
              error={field.state.meta.errors[0] as string | undefined}
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
              error={field.state.meta.errors[0] as string | undefined}
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
        <lessonForm.Field name="location_type" validators={requiredValidator}>
          {(field) => (
            <Select
              id="lesson-location"
              name="location_type"
              label="Location"
              options={locationOptions}
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              onBlur={() => field.handleBlur()}
              error={field.state.meta.errors[0] as string | undefined}
            />
          )}
        </lessonForm.Field>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <lessonForm.Subscribe selector={(s) => s.canSubmit}>
            {(canSubmit) => (
              <Button type="submit" variant="primary" disabled={!canSubmit}>
                Schedule Lesson
              </Button>
            )}
          </lessonForm.Subscribe>
        </div>
      </form>
    </Modal>
  );
}
