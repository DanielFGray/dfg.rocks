import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { Lesson, User, LocationType } from "../../lib/types.js";
import { getLessonNote, getLessonsPageData } from "../../lib/routeData.js";
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
  loader: () => getLessonsPageData(),
  component: LessonsPage,
  pendingComponent: () => <div>Loading...</div>,
});

/* ---------------------------------------------------------------------------
 * LessonsPage
 * --------------------------------------------------------------------------- */

function LessonsPage() {
  const router = useRouter();
  const { lessons, students } = Route.useLoaderData();

  const [formOpen, setFormOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Lesson | null>(null);
  const [noteState, setNoteState] = useState<NoteEditorState>(null);
  const [noteSaving, setNoteSaving] = useState(false);

  // Build student lookup by id
  const studentMap = new Map<string, User>();
  students.forEach((s) => {
    studentMap.set(s.id, s);
  });

  const studentOptions = [
    { value: "", label: "Select student..." },
    ...students.map((s) => ({ value: s.id, label: s.name })),
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
      void router.invalidate();
    },
  });

  const completeLessonMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.admin.lessons({ id }).patch({ status: "completed" });
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to complete lesson");
      }
      return data;
    },
    onSettled: () => {
      void router.invalidate();
    },
  });

  const cancelLessonMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.admin.lessons({ id }).patch({ status: "cancelled" });
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to cancel lesson");
      }
      return data;
    },
    onSettled: () => {
      void router.invalidate();
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
      const { data, error } = await api.admin
        .lessons({ id: params.lessonId })
        .notes.post(params.payload);
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to save lesson note");
      }
      if (params.publish) {
        const { data: pubData, error: publishError } = await api.admin
          .lessons({ id: params.lessonId })
          .notes.publish.patch();
        if (publishError) throw publishError;
        if (!pubData || "error" in pubData) {
          throw new Error(pubData?.error ?? "Failed to publish lesson note");
        }
        return { data: { ...data, ...pubData } };
      }
      return data;
    },
    onSuccess: () => {
      setNoteSaving(false);
      setNoteState(null);
      void router.invalidate();
    },
    onError: () => {
      setNoteSaving(false);
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
      const data = await getLessonNote({ data: { lessonId: lesson.id } });

      setNoteState({
        lesson,
        topics: data.topics_covered ?? "",
        homework: data.homework ?? "",
        progress: data.progress_observations ?? "",
        notes: data.notes ?? "",
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.toLowerCase().includes("lesson note not found")
      ) {
        return;
      }

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
    <main data-testid="lessons" className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[1100px]">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Lessons</h1>
        <Button data-testid="new-lesson" onClick={openNewLesson}>
          New Lesson
        </Button>
      </div>

      {lessons.length === 0 ? (
        <EmptyState
          message="No lessons scheduled yet."
          action={{ label: "New Lesson", onClick: openNewLesson }}
        />
      ) : (
        <div className="gap-3 flex flex-col">
          {lessons.map((lesson) => {
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
