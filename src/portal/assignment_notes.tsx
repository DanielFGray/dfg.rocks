import * as Effect from "effect/Effect";
import { Atom, AtomRegistry, Suspense } from "fibrae";
import { DfgApi, type AssignmentNote } from "./api.js";
import { Button } from "../ui/button.js";

const editingAtom = Atom.make(false);
const noteTextAtom = Atom.make("");
const savingAtom = Atom.make(false);

export function AssignmentNotes(props: {
  materialId: string;
}) {
  return Effect.gen(function* () {
    const api = yield* DfgApi;
    const registry = yield* AtomRegistry.AtomRegistry;
    const note = yield* api.authenticated.assignmentNote({ path: { materialId: props.materialId } });

    const editing = registry.get(editingAtom);
    const noteText = registry.get(noteTextAtom);
    const saving = registry.get(savingAtom);

    const startEditing = () => {
      registry.set(noteTextAtom, note?.body ?? "");
      registry.set(editingAtom, true);
    };

    const cancelEditing = () => {
      registry.set(editingAtom, false);
      registry.set(noteTextAtom, "");
    };

    const handleInput = (e: Event) => {
      const target = e.target as HTMLTextAreaElement;
      registry.set(noteTextAtom, target.value);
    };

    const handleSave = () =>
      Effect.gen(function* () {
        const api = yield* DfgApi;
        const text = registry.get(noteTextAtom);
        if (!text.trim()) return;

        registry.set(savingAtom, true);
        yield* api.authenticated.upsertAssignmentNote({ path: { materialId: props.materialId }, payload: { body: text.trim() } });
        registry.set(savingAtom, false);
        registry.set(editingAtom, false);
        registry.set(noteTextAtom, "");
      });

    if (editing) {
      return (
        <div class="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-card p-4">
          <label class="text-sm font-medium text-muted">Assignment Notes</label>
          <textarea
            rows={4}
            value={noteText}
            oninput={handleInput}
            placeholder="Add notes about this assignment..."
            class="rounded-lg border border-white/10 bg-surface px-4 py-3 text-sm text-primary placeholder:text-muted/50 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50 resize-y"
          />
          <div class="flex gap-2 justify-end">
            <Button variant="ghost" onclick={cancelEditing} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onclick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      );
    }

    if (note) {
      return (
        <div class="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-card p-4">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-muted">Notes</span>
            <Button variant="ghost" onclick={startEditing} class="text-xs px-3 py-1">
              Edit
            </Button>
          </div>
          <p class="text-sm text-primary/90 whitespace-pre-wrap">{note.body}</p>
        </div>
      );
    }

    return (
      <div class="flex items-center justify-between rounded-xl border border-dashed border-white/[0.06] bg-card/50 px-4 py-3">
        <span class="text-sm text-muted/60">No notes yet</span>
        <Button variant="ghost" onclick={startEditing} class="text-xs px-3 py-1">
          Add Note
        </Button>
      </div>
    );
  });
}
