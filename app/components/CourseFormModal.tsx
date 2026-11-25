import { Effect } from "effect";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { getErrorMessage } from "../lib/errors.js";
import { visibilityOptions } from "../lib/visibility.js";
import type { ContentVisibility } from "../../shared/schemas.js";
import { fieldError } from "../lib/form.js";
import { requiredValidator } from "../lib/validators.js";
import { Modal } from "./ui/Modal.js";
import { Input } from "./ui/Input.js";
import { Select } from "./ui/Select.js";
import { Textarea } from "./ui/Textarea.js";
import { Button } from "./ui/Button.js";

const instrumentOptions = [
  { value: "", label: "Select instrument..." },
  { value: "Guitar", label: "Guitar" },
  { value: "Piano", label: "Piano" },
  { value: "Drums", label: "Drums" },
  { value: "Bass", label: "Bass" },
  { value: "Other", label: "Other" },
];

type CourseData = {
  id: string;
  title: string;
  instrument: string;
  description: string;
  visibility: ContentVisibility;
};

type CourseFormModalProps = {
  open: boolean;
  onClose: () => void;
  course: CourseData | null;
  onSuccess: () => void;
};

export function CourseFormModal({ open, onClose, course, onSuccess }: CourseFormModalProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: {
      title: string;
      instrument: string;
      description?: string;
      visibility: ContentVisibility;
    }) => Effect.runPromise(api.coursesAdmin.createCourse({ payload })),
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: {
      id: string;
      title: string;
      instrument: string;
      description?: string;
      visibility: ContentVisibility;
    }) => Effect.runPromise(api.coursesAdmin.updateCourse({ params: { id }, payload })),
  });

  const form = useForm({
    defaultValues: {
      title: course?.title ?? "",
      instrument: course?.instrument ?? "",
      description: course?.description ?? "",
      visibility: course?.visibility ?? "course",
    },
    onSubmit: async ({ value }) => {
      const payload = {
        title: value.title,
        instrument: value.instrument,
        description: value.description || undefined,
        visibility: value.visibility,
      };
      setSubmitError(null);
      try {
        if (course) {
          await updateMutation.mutateAsync({ id: course.id, ...payload });
        } else {
          await createMutation.mutateAsync(payload);
        }
        onClose();
        onSuccess();
      } catch (cause) {
        setSubmitError(
          getErrorMessage(cause, course ? "Could not save the course" : "Could not create the course"),
        );
      }
    },
  });

  // Reset form when modal opens
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setSubmitError(null);
    form.reset({
      title: course?.title ?? "",
      instrument: course?.instrument ?? "",
      description: course?.description ?? "",
      visibility: course?.visibility ?? "course",
    });
  }
  if (!open && wasOpen) {
    setWasOpen(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={course ? "Edit Course" : "New Course"}
      isDismissable={!form.state.isSubmitting}
    >
      <form
        data-testid="course-form"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
        className="flex flex-col gap-5"
      >
        <form.Field name="title" validators={requiredValidator}>
          {(field) => (
            <Input
              id="course-title"
              name="title"
              label="Title"
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              onBlur={() => field.handleBlur()}
              error={fieldError(field.state.meta.errors)}
              placeholder="e.g. Fingerpicking Foundations"
            />
          )}
        </form.Field>
        <form.Field name="instrument" validators={requiredValidator}>
          {(field) => (
            <Select
              id="course-instrument"
              name="instrument"
              label="Instrument"
              options={instrumentOptions}
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              onBlur={() => field.handleBlur()}
              error={fieldError(field.state.meta.errors)}
            />
          )}
        </form.Field>
        <form.Field name="description">
          {(field) => (
            <Textarea
              id="course-description"
              name="description"
              label="Description"
              rows={3}
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              onBlur={() => field.handleBlur()}
              placeholder="Brief description of the course"
            />
          )}
        </form.Field>
        <form.Field name="visibility">
          {(field) => (
            <Select
              id="course-visibility"
              name="visibility"
              label="Who can read"
              options={visibilityOptions}
              value={field.state.value}
              onChange={(v) => field.handleChange(v as ContentVisibility)}
              onBlur={() => field.handleBlur()}
            />
          )}
        </form.Field>
        {submitError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {submitError}
          </p>
        ) : null}
        <div className="flex justify-end gap-3 pt-2">
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(submitting) => (
              <Button variant="ghost" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
            )}
          </form.Subscribe>
          <form.Subscribe selector={(s) => !s.canSubmit || s.isSubmitting}>
            {(blocked) => (
              <Button
                type="submit"
                variant="primary"
                disabled={blocked}
                data-testid="course-submit"
              >
                {form.state.isSubmitting
                  ? course
                    ? "Saving..."
                    : "Creating..."
                  : course
                    ? "Save Changes"
                    : "Create Course"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </Modal>
  );
}
