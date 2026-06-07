import { Effect } from "effect";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.js";

export const Route = createFileRoute("/_authed/assignment-notes")({
  head: () => ({ meta: [{ title: "Assignment Notes | DFG Portal" }] }),
  component: AssignmentNotesPage,
});

/* ---------------------------------------------------------------------------
 * AssignmentNotesPanel — reusable inline component for embedding in other pages
 * --------------------------------------------------------------------------- */

export function AssignmentNotesPanel({ materialId }: { materialId: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: note } = useQuery({
    queryKey: ["assignment-note", materialId],
    queryFn: () =>
      Effect.runPromise(api.authenticated.assignmentNotes({ path: { materialId } })),
  });

  const upsertMutation = useMutation({
    mutationFn: (body: string) =>
      Effect.runPromise(
        api.authenticated.upsertAssignmentNotes({
          path: { materialId },
          payload: { body },
        }),
      ),
    onMutate: () => setSaving(true),
    onSettled: () => {
      setSaving(false);
      setEditing(false);
      setNoteText("");
      queryClient.invalidateQueries({
        queryKey: ["assignment-note", materialId],
      });
    },
  });

  const startEditing = () => {
    setNoteText(note?.body ?? "");
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setNoteText("");
  };

  const handleSave = () => {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    upsertMutation.mutate(trimmed);
  };

  if (editing) {
    return (
      <div className="gap-3 rounded-xl border-overlay/6 dark:border-overlay-dark/6 bg-card dark:bg-card-dark p-4 flex flex-col border">
        <label className="text-sm font-medium text-muted dark:text-muted-dark">
          Assignment Notes
        </label>
        <textarea
          rows={4}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add notes about this assignment..."
          className="rounded-lg border-overlay/10 dark:border-overlay-dark/10 bg-surface dark:bg-surface-dark px-4 py-3 text-sm text-primary dark:text-primary-dark placeholder:text-muted/50 dark:placeholder:text-muted-dark/50 focus:border-accent focus:ring-accent/50 resize-y border transition-colors outline-hidden focus:ring-1"
        />
        <div className="gap-2 flex justify-end">
          <Button variant="ghost" onClick={cancelEditing} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    );
  }

  if (note) {
    return (
      <div className="gap-2 rounded-xl border-overlay/6 dark:border-overlay-dark/6 bg-card dark:bg-card-dark p-4 flex flex-col border">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted dark:text-muted-dark">
            Notes
          </span>
          <Button
            variant="ghost"
            onClick={startEditing}
            className="text-xs px-3 py-1"
          >
            Edit
          </Button>
        </div>
        <p className="text-sm text-primary/90 dark:text-primary-dark/90 whitespace-pre-wrap">
          {note.body}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-overlay/6 dark:border-overlay-dark/6 bg-card/50 dark:bg-card-dark/50 px-4 py-3 flex items-center justify-between border border-dashed">
      <span className="text-sm text-muted/60 dark:text-muted-dark/60">
        No notes yet
      </span>
      <Button
        variant="ghost"
        onClick={startEditing}
        className="text-xs px-3 py-1"
      >
        Add Note
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * AssignmentNotesPage — standalone page (renders placeholder, panel used inline)
 * --------------------------------------------------------------------------- */

function AssignmentNotesPage() {
  return (
    <main
      data-testid="assignment-notes"
      className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[1100px]"
    >
      <h1 className="text-3xl font-bold tracking-tight mb-8">
        Assignment Notes
      </h1>
      <p className="text-muted dark:text-muted-dark">
        Select an assignment to view or edit notes.
      </p>
    </main>
  );
}
