import * as Effect from "effect/Effect";
import { Atom, AtomRegistry, Suspense } from "fibrae";
import { NavigatorTag } from "fibrae/router";
import { DfgApi, uploadMaterial, type Material } from "./api.js";
import { currentUser, isAdmin } from "./auth.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Modal } from "../ui/modal.js";
import { EmptyState } from "../ui/empty_state.js";

/* ---------------------------------------------------------------------------
 * Atoms for upload modal state
 * --------------------------------------------------------------------------- */

const uploadModalOpen = Atom.make(false);

/* ---------------------------------------------------------------------------
 * LibraryContent — main Effect component
 * --------------------------------------------------------------------------- */

function LibraryContent() {
  return Effect.gen(function* () {
    const api = yield* DfgApi;
    const registry = yield* AtomRegistry.AtomRegistry;
    const user = registry.get(currentUser);
    const admin = isAdmin(user);
    const materials = yield* api.authenticated.library({ urlParams: {} });

    const showUploadModal = registry.get(uploadModalOpen);

    /* -- helpers to refresh the page after mutations -- */
    const refresh = Effect.gen(function* () {
      const navigator = yield* NavigatorTag;
      yield* navigator.go("/library");
    });

    /* -- Upload modal handlers -- */
    const openUpload = () => {
      registry.set(uploadModalOpen, true);
    };

    const closeUpload = () => {
      registry.set(uploadModalOpen, false);
    };

    const handleUploadSubmit = (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const data = new FormData(form);
      const file = data.get("file");
      const title = data.get("title") as string;
      if (!file || !(file instanceof File) || !title) return;

      return Effect.gen(function* () {
        yield* uploadMaterial(file, title, true);
        registry.set(uploadModalOpen, false);
        yield* refresh;
      });
    };

    /* -- Format file size helper -- */
    const formatSize = (bytes: number) =>
      bytes > 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.round(bytes / 1024)} KB`;

    return (
      <div>
        {/* ---- Header with upload button ---- */}
        <div class="flex items-center justify-between mb-8">
          <h1 class="text-3xl font-bold tracking-tight">Library</h1>
          {admin ? (
            <Button onclick={openUpload} data-cy="upload-material">
              Upload Material
            </Button>
          ) : null}
        </div>

        {/* ---- Materials list ---- */}
        {materials.length === 0 ? (
          <EmptyState
            message={
              admin
                ? "No materials in the library yet. Upload your first file."
                : "No materials in the library yet."
            }
            action={
              admin
                ? { label: "Upload Material", onclick: openUpload }
                : undefined
            }
          />
        ) : (
          <div class="flex flex-col gap-2">
            {(materials as Material[]).map((m) => (
              <div class="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-card px-4 py-3 text-sm">
                <span class="text-primary font-medium flex-1">{m.title}</span>
                <span class="text-muted/60 text-xs">
                  {m.original_filename}
                </span>
                <span class="text-muted/40 text-xs">{formatSize(m.file_size)}</span>
              </div>
            ))}
          </div>
        )}

        {/* ---- Upload Modal ---- */}
        {admin ? (
          <Modal open={showUploadModal} onclose={closeUpload} title="Upload Material">
            <form
              onsubmit={handleUploadSubmit}
              data-cy="upload-material-form"
              class="flex flex-col gap-5"
            >
              <Input
                id="material-title"
                name="title"
                label="Title"
                required
                placeholder="e.g. Scales Reference Sheet"
              />
              <div class="flex flex-col gap-1.5">
                <label for="material-file" class="text-sm font-medium text-muted">
                  File
                </label>
                <input
                  id="material-file"
                  name="file"
                  type="file"
                  required
                  class="rounded-lg border border-white/10 bg-card px-4 py-3 text-primary file:mr-4 file:rounded-lg file:border-0 file:bg-accent/20 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-accent hover:file:bg-accent/30 file:cursor-pointer outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50"
                />
              </div>
              <div class="flex justify-end gap-3 mt-2">
                <Button variant="ghost" onclick={closeUpload}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Upload
                </Button>
              </div>
            </form>
          </Modal>
        ) : null}
      </div>
    );
  });
}

/* ---------------------------------------------------------------------------
 * LibraryPage — public export
 * --------------------------------------------------------------------------- */

export const LibraryPage = () => (
  <main data-cy="library" class="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16">
    <Suspense fallback={<p class="text-muted">Loading materials...</p>} threshold={50}>
      <LibraryContent />
    </Suspense>
  </main>
);
