import { Effect } from "effect";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.js";
import { Textarea } from "../../components/ui/Textarea.js";

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
    queryFn: () => Effect.runPromise(api.materials.assignmentNotes({ params: { materialId } })),
  });

  const upsertMutation = useMutation({
    mutationFn: (body: string) =>
      Effect.runPromise(
        api.materials.upsertAssignmentNotes({
          params: { materialId },
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
      <div className="flex flex-col gap-3 rounded-xl border border-overlay/6 bg-card p-4">
        <Textarea
          id="assignment-notes"
          name="assignment-notes"
          label="Assignment Notes"
          value={noteText}
          onChange={setNoteText}
          placeholder="Add notes about this assignment..."
          rows={4}
        />
        <div className="flex justify-end gap-2">
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
      <div className="flex flex-col gap-2 rounded-xl border border-overlay/6 bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted">Notes</span>
          <Button variant="ghost" onClick={startEditing} className="px-3 py-1 text-xs">
            Edit
          </Button>
        </div>
        <p className="text-sm whitespace-pre-wrap text-primary/90">
          {note.body}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-dashed border-overlay/6 bg-card/50 px-4 py-3">
      <span className="text-sm text-muted/60">No notes yet</span>
      <Button variant="ghost" onClick={startEditing} className="px-3 py-1 text-xs">
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
      className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 md:px-8"
    >
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Assignment Notes</h1>
      <p className="text-muted">Select an assignment to view or edit notes.</p>
    </main>
  );
}
