import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { adminLessonsQuery, adminStudentsQuery, unwrap } from "../../lib/queries.js";
import type { Lesson, LessonNote, User, LocationType } from "../../lib/types.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { formatDateTime } from "../../components/lessons/helpers.js";
import { NoteEditorModal } from "../../components/lessons/NoteEditorModal.js";
import type { NoteEditorState, NoteFormValues } from "../../components/lessons/NoteEditorModal.js";
import { NewLessonModal } from "../../components/lessons/NewLessonModal.js";
import { LessonCard } from "../../components/lessons/LessonCard.js";

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
      const { data } = await api.admin.lessons.post(payload);
      return data;
    },
    onSettled: () => {
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin-lessons"] });
    },
  });

  const completeLessonMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.admin.lessons({ id }).patch({ status: "completed" });
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-lessons"] });
    },
  });

  const cancelLessonMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.admin.lessons({ id }).patch({ status: "cancelled" });
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
      const { data } = await api.admin.lessons({ id: params.lessonId }).notes.post(params.payload);
      if (params.publish) {
        const { data: pubData } = await api.admin.lessons({ id: params.lessonId }).notes.publish.patch();
        return { data: { ...data, ...pubData } };
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

  const openNewLesson = () => {
    setFormOpen(true);
  };

  const confirmCancel = () => {
    if (!cancelTarget) return;
    cancelLessonMutation.mutate(cancelTarget.id);
    setCancelTarget(null);
  };

  const openNoteEditor = async (lesson: Lesson) => {
    try {
      const note = unwrap((await api.admin.lessons({ id: lesson.id }).notes.get()).data) as LessonNote;
      setNoteState({
        lesson,
        topics: note.topics_covered ?? "",
        homework: note.homework ?? "",
        progress: note.progress_observations ?? "",
        notes: note.notes ?? "",
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
        <Button data-pwid="new-lesson" onClick={openNewLesson}>
          New Lesson
        </Button>
      </div>

      {lessons.length === 0 ? (
        <EmptyState
          message="No lessons scheduled yet."
          action={{ label: "New Lesson", onClick: openNewLesson }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {(lessons as Lesson[]).map((lesson) => {
            const student = studentMap.get(lesson.student_id);
            const studentName = student ? student.name : "Unknown Student";

            return (
              <LessonCard
                key={lesson.id}
                lesson={lesson}
                studentName={studentName}
                onNotes={() => openNoteEditor(lesson)}
                onComplete={() => completeLessonMutation.mutate(lesson.id)}
                onCancel={() => setCancelTarget(lesson)}
              />
            );
          })}
        </div>
      )}

      {/* ---- New Lesson Modal ---- */}
      <NewLessonModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        studentOptions={studentOptions}
        onSubmit={(value) => createLessonMutation.mutate(value)}
      />

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
