import { Effect } from "effect";
import * as S from "effect/Schema";
import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { api } from "../../lib/api.js";
import { getErrorMessage } from "../../lib/errors.js";
import type { Lesson, User, LocationType } from "../../../shared/schemas.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { formatDateTime } from "../../components/lessons/helpers.js";
import { NoteEditorModal } from "../../components/lessons/NoteEditorModal.js";
import type { NoteEditorState, NoteFormValues } from "../../components/lessons/NoteEditorModal.js";
import { EditLessonModal } from "../../components/lessons/EditLessonModal.js";
import { NewLessonModal } from "../../components/lessons/NewLessonModal.js";
import { LessonCard } from "../../components/lessons/LessonCard.js";
import { serverRuntime } from "../../../server/runtime.js";
import { AdminRouteService } from "../../../server/services/adminRouteService.js";
import {
  serializeLesson,
  serializeLessonNote,
  normalizeStudents,
} from "../../../shared/responseMappers.js";
import { requireAdminSession } from "../../lib/sessionGuards.server.js";
import { toServerFunctionPayload } from "../../lib/serverFunctionPayload.js";

const getLessonsPageData = createServerFn({ method: "GET" }).handler(() =>
  serverRuntime.runPromise(
    Effect.gen(function* () {
      const session = yield* requireAdminSession(getCookie("session"));
      const [lessons, students] = yield* Effect.all([
        AdminRouteService.use((adminRouteService) =>
          adminRouteService.listLessons(session.session.id, { limit: 50, offset: 0 }),
        ),
        AdminRouteService.use((adminRouteService) =>
          adminRouteService.listStudents(session.session.id),
        ),
      ]);

      return toServerFunctionPayload({
        lessons: lessons.map(serializeLesson),
        students: normalizeStudents(students),
      }) as {
        lessons: ReturnType<typeof serializeLesson>[];
        students: User[];
      };
    }),
  ),
);

const getLessonNote = createServerFn({ method: "GET" })
  .validator(S.toStandardSchemaV1(S.Struct({ lessonId: S.String })))
  .handler(({ data }) =>
    serverRuntime.runPromise(
      Effect.gen(function* () {
        const session = yield* requireAdminSession(getCookie("session"));
        const note = yield* AdminRouteService.use((adminRouteService) =>
          adminRouteService.getLessonNote(session.session.id, data.lessonId),
        );
        return serializeLessonNote(note);
      }),
    ),
  );

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
  const [editTarget, setEditTarget] = useState<Lesson | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Lesson | null>(null);
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
    mutationFn: (payload: {
      student_id: string;
      scheduled_at: string;
      duration_minutes: number;
      location_type: LocationType;
    }) => Effect.runPromise(api.admin.createLesson({ payload })),
    onSettled: () => {
      setFormOpen(false);
      void router.invalidate();
    },
  });

  const completeLessonMutation = useMutation({
    mutationFn: (id: string) => Effect.runPromise(api.admin.completeLesson({ params: { id } })),
    onSettled: () => {
      void router.invalidate();
    },
  });

  const cancelLessonMutation = useMutation({
    mutationFn: (id: string) =>
      Effect.runPromise(api.admin.cancelLesson({ params: { id }, payload: {} })),
    onSettled: () => {
      void router.invalidate();
    },
  });

  const updateLessonMutation = useMutation({
    mutationFn: (params: { id: string; payload: Record<string, unknown> }) =>
      Effect.runPromise(
        api.admin.updateLesson({
          params: { id: params.id },
          payload: params.payload,
        }),
      ),
    onSettled: () => {
      setEditTarget(null);
      void router.invalidate();
    },
  });

  const deleteLessonMutation = useMutation({
    mutationFn: (id: string) => Effect.runPromise(api.admin.deleteLesson({ params: { id } })),
    onSettled: () => {
      setDeleteTarget(null);
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
      const data = await Effect.runPromise(
        api.admin.saveLessonNote({
          params: { id: params.lessonId },
          payload: params.payload,
        }),
      );
      if (params.publish) {
        const pubData = await Effect.runPromise(
          api.admin.publishLessonNote({ params: { id: params.lessonId } }),
        );
        return { ...data, ...pubData };
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
      if (!getErrorMessage(error, "").toLowerCase().includes("lesson note not found")) {
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
    <main data-testid="lessons" className="mx-auto max-w-275 px-5 pt-20 pb-16 md:px-8">
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
        <div className="flex flex-col gap-3">
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
                onEdit={() => setEditTarget(lesson)}
                onDelete={() => setDeleteTarget(lesson)}
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

      {/* ---- Edit Lesson Modal ---- */}
      {editTarget ? (
        <EditLessonModal
          open={editTarget !== null}
          onClose={() => setEditTarget(null)}
          lesson={editTarget}
          studentOptions={studentOptions}
          onSubmit={(value) =>
            updateLessonMutation.mutate({
              id: editTarget.id,
              payload: value as Record<string, unknown>,
            })
          }
        />
      ) : null}

      {/* ---- Delete Confirm Dialog ---- */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Lesson"
        message={
          deleteTarget
            ? `Permanently delete the lesson with ${studentMap.get(deleteTarget.student_id)?.name ?? "this student"} on ${formatDateTime(deleteTarget.scheduled_at)}? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete Forever"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) deleteLessonMutation.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
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
