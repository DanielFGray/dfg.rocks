import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import * as v from "valibot";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Modal } from "./ui/Modal.js";
import { Input } from "./ui/Input.js";
import { Select } from "./ui/Select.js";
import { Textarea } from "./ui/Textarea.js";
import { Button } from "./ui/Button.js";

const requiredValidator = {
  onChange: v.pipe(v.string(), v.minLength(1, "Required")),
};

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
};

type CourseFormModalProps = {
  open: boolean;
  onClose: () => void;
  course: CourseData | null;
  onSuccess: () => void;
};

export function CourseFormModal({ open, onClose, course, onSuccess }: CourseFormModalProps) {
  const createMutation = useMutation({
    mutationFn: async (payload: { title: string; instrument: string; description?: string }) => {
      const { data, error } = await api.admin.courses.post(payload);
      if (error) throw error;
      return data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...payload }: { id: string; title: string; instrument: string; description?: string }) => {
      const { data, error } = await api.admin.courses({ id }).patch(payload);
      if (error) throw error;
      return data;
    },
  });

  const form = useForm({
    defaultValues: {
      title: course?.title ?? "",
      instrument: course?.instrument ?? "",
      description: course?.description ?? "",
    },
    onSubmit: async ({ value }) => {
      const payload = {
        title: value.title,
        instrument: value.instrument,
        description: value.description || undefined,
      };
      const opts = {
        onSuccess: () => {
          onClose();
          onSuccess();
        },
      };
      if (course) {
        updateMutation.mutate({ id: course.id, ...payload }, opts);
      } else {
        createMutation.mutate(payload, opts);
      }
    },
  });

  // Reset form when modal opens
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    form.reset({
      title: course?.title ?? "",
      instrument: course?.instrument ?? "",
      description: course?.description ?? "",
    });
  }
  if (!open && wasOpen) {
    setWasOpen(false);
  }

  return (
    <Modal open={open} onClose={onClose} title={course ? "Edit Course" : "New Course"}>
      <form
        data-pwid="course-form"
        onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}
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
              error={field.state.meta.errors[0] as string | undefined}
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
              error={field.state.meta.errors[0] as string | undefined}
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
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <form.Subscribe selector={(s) => s.canSubmit}>
            {(canSubmit) => (
              <Button type="submit" variant="primary" disabled={!canSubmit}>
                {course ? "Save Changes" : "Create Course"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </Modal>
  );
}
