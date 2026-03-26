import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { unwrap } from "../../lib/queries.js";
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
    queryFn: async () => unwrap((await api.assignments({ materialId }).notes.get()).data),
  });

  const upsertMutation = useMutation({
    mutationFn: async (body: string) => unwrap((await api.assignments({ materialId }).notes.put({ body })).data),
    onMutate: () => setSaving(true),
    onSettled: () => {
      setSaving(false);
      setEditing(false);
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["assignment-note", materialId] });
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
      <div className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-card p-4">
        <label className="text-sm font-medium text-muted">Assignment Notes</label>
        <textarea
          rows={4}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add notes about this assignment..."
          className="rounded-lg border border-white/10 bg-surface px-4 py-3 text-sm text-primary placeholder:text-muted/50 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50 resize-y"
        />
        <div className="flex gap-2 justify-end">
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
      <div className="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted">Notes</span>
          <Button variant="ghost" onClick={startEditing} className="text-xs px-3 py-1">
            Edit
          </Button>
        </div>
        <p className="text-sm text-primary/90 whitespace-pre-wrap">{note.body}</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-dashed border-white/[0.06] bg-card/50 px-4 py-3">
      <span className="text-sm text-muted/60">No notes yet</span>
      <Button variant="ghost" onClick={startEditing} className="text-xs px-3 py-1">
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
    <main data-pwid="assignment-notes" className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16">
      <h1 className="text-3xl font-bold tracking-tight mb-8">Assignment Notes</h1>
      <p className="text-muted">Select an assignment to view or edit notes.</p>
    </main>
  );
}
