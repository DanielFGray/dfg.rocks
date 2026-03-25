import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { Lesson, User, LocationType } from "../../lib/types.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { Modal } from "../../components/ui/Modal.js";
import { Input } from "../../components/ui/Input.js";
import { Select } from "../../components/ui/Select.js";
import { Textarea } from "../../components/ui/Textarea.js";

/* ---------------------------------------------------------------------------
 * Query Options
 * --------------------------------------------------------------------------- */

const adminLessonsQuery = queryOptions({
  queryKey: ["admin-lessons"],
  queryFn: async () => {
    const { data, error } = await api.admin.lessons.get();
    if (error) throw error;
    return data;
  },
});

const adminStudentsQuery = queryOptions({
  queryKey: ["admin-students"],
  queryFn: async () => {
    const { data, error } = await api.admin.students.get();
    if (error) throw error;
    return data;
  },
});

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

export const Route = createFileRoute("/_authed/lessons")({
  head: () => ({ meta: [{ title: "Lessons | DFG Portal" }] }),
  loader: async ({ context: { queryClient } }) => {
    await Promise.allSettled([
      queryClient.ensureQueryData(adminLessonsQuery),
      queryClient.ensureQueryData(adminStudentsQuery),
    ]);
  },
  component: LessonsPage,
  pendingComponent: () => <div>Loading...</div>,
});

/* ---------------------------------------------------------------------------
 * Constants
 * --------------------------------------------------------------------------- */

const durationOptions = [
  { value: "30", label: "30 minutes" },
  { value: "60", label: "60 minutes" },
];

const locationOptions = [
  { value: "", label: "Select location..." },
  { value: "in_person_teacher_travels", label: "In-Person (Teacher Travels)" },
  { value: "in_person_student_travels", label: "In-Person (Student Travels)" },
  { value: "studio", label: "Studio" },
  { value: "online", label: "Online" },
];

const statusBadgeClass: Record<string, string> = {
  scheduled: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  cancelled: "bg-red-500/20 text-red-400",
  no_show: "bg-amber-500/20 text-amber-400",
};

const statusLabel: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

const locationLabel: Record<string, string> = {
  in_person_teacher_travels: "In-Person (Teacher Travels)",
  in_person_student_travels: "In-Person (Student Travels)",
  studio: "Studio",
  online: "Online",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ---------------------------------------------------------------------------
 * NoteEditorModal
 * --------------------------------------------------------------------------- */

type NoteEditorState = {
  lesson: Lesson;
  topics: string;
  homework: string;
  progress: string;
  notes: string;
} | null;

type NoteFormValues = {
  topics_covered: string;
  homework: string;
  progress_observations: string;
  notes: string;
};

function NoteEditorModal({
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
  const [topics, setTopics] = useState(state?.topics ?? "");
  const [homework, setHomework] = useState(state?.homework ?? "");
  const [progress, setProgress] = useState(state?.progress ?? "");
  const [notes, setNotes] = useState(state?.notes ?? "");

  // Sync state when the modal opens with new data
  const lessonId = state?.lesson.id;
  const [prevLessonId, setPrevLessonId] = useState(lessonId);
  if (lessonId !== prevLessonId) {
    setPrevLessonId(lessonId);
    setTopics(state?.topics ?? "");
    setHomework(state?.homework ?? "");
    setProgress(state?.progress ?? "");
    setNotes(state?.notes ?? "");
  }

  const handleSave = (draft: boolean) => {
    onSave(draft, {
      topics_covered: topics,
      homework,
      progress_observations: progress,
      notes,
    });
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
        <Textarea
          id="note-topics"
          name="topics_covered"
          label="Topics Covered"
          rows={3}
          value={topics}
          onChange={(e) => setTopics(e.target.value)}
          placeholder="What was covered in this lesson?"
        />
        <Textarea
          id="note-homework"
          name="homework"
          label="Homework"
          rows={3}
          value={homework}
          onChange={(e) => setHomework(e.target.value)}
          placeholder="Assigned homework or practice tasks"
        />
        <Textarea
          id="note-progress"
          name="progress_observations"
          label="Progress Observations"
          rows={3}
          value={progress}
          onChange={(e) => setProgress(e.target.value)}
          placeholder="How is the student progressing?"
        />
        <Textarea
          id="note-notes"
          name="notes"
          label="Notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Additional notes"
        />
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

/* ---------------------------------------------------------------------------
 * LessonsPage
 * --------------------------------------------------------------------------- */

function LessonsPage() {
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Lesson | null>(null);
  const [noteState, setNoteState] = useState<NoteEditorState>(null);
  const [noteSaving, setNoteSaving] = useState(false);

  const { data: lessons } = useSuspenseQuery(adminLessonsQuery);
  const { data: students } = useSuspenseQuery(adminStudentsQuery);

  // Build student lookup by id
  const studentMap = new Map<string, User>();
  (students as User[]).forEach((s) => {
    studentMap.set(s.id, s);
  });

  const studentOptions = [
    { value: "", label: "Select student..." },
    ...(students as User[]).map((s) => ({ value: s.id, label: s.name })),
  ];

  /* -- Mutations -- */

  const createLessonMutation = useMutation({
    mutationFn: async (payload: {
      student_id: string;
      scheduled_at: string;
      duration_minutes: number;
      location_type: LocationType;
    }) => {
      const { data, error } = await api.admin.lessons.post(payload);
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin-lessons"] });
    },
  });

  const completeLessonMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.admin.lessons[id].patch({ status: "completed" });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-lessons"] });
    },
  });

  const cancelLessonMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.admin.lessons[id].patch({ status: "cancelled" });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-lessons"] });
    },
  });

  const upsertNoteMutation = useMutation({
    mutationFn: async (params: {
      lessonId: string;
      payload: {
        topics_covered?: string;
        homework?: string;
        progress_observations?: string;
        notes?: string;
        draft?: boolean;
      };
      publish: boolean;
    }) => {
      const { data, error } = await api.admin.lessons[params.lessonId].notes.post(params.payload);
      if (error) throw error;
      if (params.publish) {
        const { error: pubError } = await api.admin.lessons[params.lessonId].notes.publish.patch();
        if (pubError) throw pubError;
      }
      return data;
    },
    onSettled: () => {
      setNoteSaving(false);
      setNoteState(null);
      queryClient.invalidateQueries({ queryKey: ["admin-lessons"] });
    },
  });

  /* -- Handlers -- */

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    createLessonMutation.mutate({
      student_id: data.get("student_id") as string,
      scheduled_at: data.get("scheduled_at") as string,
      duration_minutes: Number(data.get("duration_minutes") as string),
      location_type: data.get("location_type") as LocationType,
    });
  };

  const confirmCancel = () => {
    if (!cancelTarget) return;
    cancelLessonMutation.mutate(cancelTarget.id);
    setCancelTarget(null);
  };

  const openNoteEditor = async (lesson: Lesson) => {
    try {
      const { data, error } = await api.admin.lessons[lesson.id].notes.get();
      if (error) throw error;
      setNoteState({
        lesson,
        topics: data.topics_covered ?? "",
        homework: data.homework ?? "",
        progress: data.progress_observations ?? "",
        notes: data.notes ?? "",
      });
    } catch {
      setNoteState({
        lesson,
        topics: "",
        homework: "",
        progress: "",
        notes: "",
      });
    }
  };

  const handleSaveNote = (draft: boolean, values: NoteFormValues) => {
    if (!noteState) return;
    setNoteSaving(true);

    upsertNoteMutation.mutate({
      lessonId: noteState.lesson.id,
      payload: {
        topics_covered: values.topics_covered || undefined,
        homework: values.homework || undefined,
        progress_observations: values.progress_observations || undefined,
        notes: values.notes || undefined,
        draft,
      },
      publish: !draft,
    });
  };

  return (
    <main data-pwid="lessons" className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Lessons</h1>
        <Button data-pwid="new-lesson" onClick={() => setFormOpen(true)}>
          New Lesson
        </Button>
      </div>

      {lessons.length === 0 ? (
        <EmptyState
          message="No lessons scheduled yet."
          action={{ label: "New Lesson", onClick: () => setFormOpen(true) }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {(lessons as Lesson[]).map((lesson) => {
            const student = studentMap.get(lesson.student_id);
            const studentName = student ? student.name : "Unknown Student";
            const badge = statusBadgeClass[lesson.status] ?? "bg-white/10 text-muted";
            const label = statusLabel[lesson.status] ?? lesson.status;
            const location = locationLabel[lesson.location_type] ?? lesson.location_type;

            return (
              <Card key={lesson.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-semibold text-primary">{studentName}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge}`}>
                        {label}
                      </span>
                    </div>
                    <p className="text-sm text-muted">
                      {formatDateTime(lesson.scheduled_at)} · {lesson.duration_minutes} min · {location}
                    </p>
                    {lesson.cancellation_reason ? (
                      <p className="text-xs text-red-400/80 mt-1">
                        Reason: {lesson.cancellation_reason}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      onClick={() => openNoteEditor(lesson)}
                      className="text-xs px-3 py-1.5 text-violet-400 hover:text-violet-300"
                      data-pwid="lesson-notes"
                    >
                      Notes
                    </Button>
                    {lesson.status === "scheduled" ? (
                      <>
                        <Button
                          variant="ghost"
                          onClick={() => completeLessonMutation.mutate(lesson.id)}
                          className="text-xs px-3 py-1.5 text-green-400 hover:text-green-300"
                          data-pwid="complete-lesson"
                        >
                          Complete
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setCancelTarget(lesson)}
                          className="text-xs px-3 py-1.5 text-red-400 hover:text-red-300"
                          data-pwid="cancel-lesson"
                        >
                          Cancel
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ---- New Lesson Modal ---- */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="New Lesson">
        <form
          data-pwid="lesson-form"
          onSubmit={handleCreate}
          className="flex flex-col gap-5"
        >
          <Select
            id="lesson-student"
            name="student_id"
            label="Student"
            options={studentOptions}
            required
          />
          <Input
            id="lesson-scheduled-at"
            name="scheduled_at"
            label="Date & Time"
            type="datetime-local"
            required
          />
          <Select
            id="lesson-duration"
            name="duration_minutes"
            label="Duration"
            options={durationOptions}
            value="60"
            required
          />
          <Select
            id="lesson-location"
            name="location_type"
            label="Location"
            options={locationOptions}
            required
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Schedule Lesson
            </Button>
          </div>
        </form>
      </Modal>

      {/* ---- Cancel Confirm Dialog ---- */}
      <ConfirmDialog
        open={cancelTarget !== null}
        title="Cancel Lesson"
        message={
          cancelTarget
            ? `Cancel the lesson with ${studentMap.get(cancelTarget.student_id)?.name ?? "this student"} on ${formatDateTime(cancelTarget.scheduled_at)}?`
            : ""
        }
        confirmLabel="Cancel Lesson"
        variant="danger"
        onConfirm={confirmCancel}
        onCancel={() => setCancelTarget(null)}
      />

      {/* ---- Lesson Notes Modal ---- */}
      <NoteEditorModal
        state={noteState}
        studentMap={studentMap}
        onClose={() => setNoteState(null)}
        onSave={handleSaveNote}
        saving={noteSaving}
      />
    </main>
  );
}
