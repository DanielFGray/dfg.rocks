import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Modal } from "../ui/Modal.js";
import { Textarea } from "../ui/Textarea.js";
import { Button } from "../ui/Button.js";
import type { Lesson, User } from "../../lib/types.js";
import { formatDateTime } from "./helpers.js";

export type NoteEditorState = {
  lesson: Lesson;
  topics: string;
  homework: string;
  progress: string;
  notes: string;
} | null;

export type NoteFormValues = {
  topics_covered: string;
  homework: string;
  progress_observations: string;
  notes: string;
};

export function NoteEditorModal({
  state,
  studentMap,
  onClose,
  onSave,
  saving,
}: {
  state: NoteEditorState;
  studentMap: Map<string, User>;
  onClose: () => void;
  onSave: (draft: boolean, values: NoteFormValues) => void;
  saving: boolean;
}) {
  const noteForm = useForm({
    defaultValues: {
      topics_covered: state?.topics ?? "",
      homework: state?.homework ?? "",
      progress_observations: state?.progress ?? "",
      notes: state?.notes ?? "",
    },
  });

  // Sync form when modal opens with new lesson data
  const lessonId = state?.lesson.id;
  const [prevLessonId, setPrevLessonId] = useState(lessonId);
  if (lessonId !== prevLessonId) {
    setPrevLessonId(lessonId);
    noteForm.reset({
      topics_covered: state?.topics ?? "",
      homework: state?.homework ?? "",
      progress_observations: state?.progress ?? "",
      notes: state?.notes ?? "",
    });
  }

  const handleSave = (draft: boolean) => {
    onSave(draft, noteForm.state.values);
  };

  const title = state
    ? `Notes \u2014 ${studentMap.get(state.lesson.student_id)?.name ?? "Lesson"} (${formatDateTime(state.lesson.scheduled_at)})`
    : "Lesson Notes";

  return (
    <Modal
      open={state !== null}
      onClose={onClose}
      title={title}
    >
      <div className="flex flex-col gap-4" data-pwid="note-editor">
        <noteForm.Field name="topics_covered">
          {(field) => (
            <Textarea
              id="note-topics"
              name="topics_covered"
              label="Topics Covered"
              rows={3}
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              onBlur={() => field.handleBlur()}
              placeholder="What was covered in this lesson?"
            />
          )}
        </noteForm.Field>
        <noteForm.Field name="homework">
          {(field) => (
            <Textarea
              id="note-homework"
              name="homework"
              label="Homework"
              rows={3}
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              onBlur={() => field.handleBlur()}
              placeholder="Assigned homework or practice tasks"
            />
          )}
        </noteForm.Field>
        <noteForm.Field name="progress_observations">
          {(field) => (
            <Textarea
              id="note-progress"
              name="progress_observations"
              label="Progress Observations"
              rows={3}
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              onBlur={() => field.handleBlur()}
              placeholder="How is the student progressing?"
            />
          )}
        </noteForm.Field>
        <noteForm.Field name="notes">
          {(field) => (
            <Textarea
              id="note-notes"
              name="notes"
              label="Notes"
              rows={3}
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              onBlur={() => field.handleBlur()}
              placeholder="Additional notes"
            />
          )}
        </noteForm.Field>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSave(true)}
            disabled={saving}
            data-pwid="save-note-draft"
          >
            Save Draft
          </Button>
          <Button
            variant="primary"
            onClick={() => handleSave(false)}
            disabled={saving}
            data-pwid="publish-note"
          >
            Publish
          </Button>
        </div>
      </div>
    </Modal>
  );
}
