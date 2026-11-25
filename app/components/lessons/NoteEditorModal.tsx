import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Modal } from "../ui/Modal.js";
import { Textarea } from "../ui/Textarea.js";
import { Button } from "../ui/Button.js";
import { getErrorMessage } from "../../lib/errors.js";
import type { Lesson, User } from "../../../shared/schemas.js";
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
}: {
  state: NoteEditorState;
  studentMap: Map<string, User>;
  onClose: () => void;
  /** Awaited contract: the modal stays open with its controls disabled until the promise settles. */
  onSave: (draft: boolean, values: NoteFormValues) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
  }

  const handleSave = async (draft: boolean) => {
    setError(null);
    setSaving(true);
    try {
      await onSave(draft, noteForm.state.values);
    } catch (cause) {
      setError(getErrorMessage(cause, "Could not save the note"));
    } finally {
      setSaving(false);
    }
  };

  const title = state
    ? `Notes \u2014 ${studentMap.get(state.lesson.student_id)?.name ?? "Lesson"} (${formatDateTime(state.lesson.scheduled_at)})`
    : "Lesson Notes";

  return (
    <Modal open={state !== null} onClose={onClose} title={title} isDismissable={!saving}>
      <div className="flex flex-col gap-4" data-testid="note-editor">
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
        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSave(true)}
            disabled={saving}
            data-testid="save-note-draft"
          >
            Save Draft
          </Button>
          <Button
            variant="primary"
            onClick={() => handleSave(false)}
            disabled={saving}
            data-testid="publish-note"
          >
            Publish
          </Button>
        </div>
      </div>
    </Modal>
  );
}
