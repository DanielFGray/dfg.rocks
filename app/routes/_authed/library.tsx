import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, uploadMaterial } from "../../lib/api.js";
import { libraryQuery } from "../../lib/queries.js";
import type { Material } from "../../lib/types.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Button } from "../../components/ui/Button.js";
import { Input } from "../../components/ui/Input.js";
import { Modal } from "../../components/ui/Modal.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { MaterialCard } from "../../components/library/MaterialCard.js";

export const Route = createFileRoute("/_authed/library")({
  loader: ({ context }) => context.queryClient.ensureQueryData(libraryQuery),
  head: () => ({ meta: [{ title: "Library | DFG Portal" }] }),
  component: LibraryPage,
  pendingComponent: () => (
    <main className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16 text-muted">Loading...</main>
  ),
});

function LibraryPage() {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null);

  const { data: materials } = useSuspenseQuery(libraryQuery);

  const uploadMutation = useMutation({
    mutationFn: async ({ file, title }: { file: File; title: string }) =>
      uploadMaterial(file, title, true),
    onSuccess: () => {
      setUploadModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.admin.materials({ id }).delete();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleUploadSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const title = data.get("title") as string;
    if (!file || !(file instanceof File) || !title) return;
    uploadMutation.mutate({ file, title });
  };

  return (
    <main data-pwid="library" className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16">
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Library</h1>
        {isAdmin ? (
          <Button onClick={() => setUploadModalOpen(true)} data-pwid="upload-material">
            Upload Material
          </Button>
        ) : null}
      </div>

      {/* ---- Materials ---- */}
      {materials.length === 0 ? (
        <EmptyState
          message={
            isAdmin
              ? "No materials in the library yet. Upload your first file."
              : "No materials in the library yet."
          }
          action={
            isAdmin
              ? { label: "Upload Material", onClick: () => setUploadModalOpen(true) }
              : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {(materials as Material[]).map((m) => (
            <MaterialCard
              key={m.id}
              material={m}
              expanded={expandedId === m.id}
              onToggle={() => toggleExpand(m.id)}
              admin={isAdmin}
              onDelete={() => setDeleteTarget(m)}
            />
          ))}
        </div>
      )}

      {/* ---- Upload Modal ---- */}
      {isAdmin ? (
        <Modal open={uploadModalOpen} onClose={() => setUploadModalOpen(false)} title="Upload Material">
          <form
            onSubmit={handleUploadSubmit}
            data-pwid="upload-material-form"
            className="flex flex-col gap-5"
          >
            <Input
              id="material-title"
              name="title"
              label="Title"
              required
              placeholder="e.g. Scales Reference Sheet"
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="material-file" className="text-sm font-medium text-muted">
                File
              </label>
              <input
                id="material-file"
                name="file"
                type="file"
                required
                className="rounded-lg border border-white/10 bg-card px-4 py-3 text-primary file:mr-4 file:rounded-lg file:border-0 file:bg-accent/20 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-accent hover:file:bg-accent/30 file:cursor-pointer outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50"
              />
            </div>
            <div className="flex justify-end gap-3 mt-2">
              <Button variant="ghost" onClick={() => setUploadModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Upload
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {isAdmin ? (
        <ConfirmDialog
          open={deleteTarget !== null}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
          }}
          title="Delete Material"
          message={`Are you sure you want to delete "${deleteTarget?.title ?? ""}"? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
        />
      ) : null}
    </main>
  );
}
