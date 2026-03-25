import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, uploadMaterial } from "../../lib/api.js";
import type { Material } from "../../lib/types.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Button } from "../../components/ui/Button.js";
import { Input } from "../../components/ui/Input.js";
import { Modal } from "../../components/ui/Modal.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

const libraryQuery = queryOptions({
  queryKey: ["library"],
  queryFn: async () => {
    const { data, error } = await api.library.get();
    if (error) throw error;
    return data;
  },
});

export const Route = createFileRoute("/_authed/library")({
  loader: ({ context }) => context.queryClient.ensureQueryData(libraryQuery),
  head: () => ({ meta: [{ title: "Library | DFG Portal" }] }),
  component: LibraryPage,
  pendingComponent: () => (
    <main className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16 text-muted">Loading...</main>
  ),
});

/* ---------------------------------------------------------------------------
 * File type helpers
 * --------------------------------------------------------------------------- */

type FileCategory = "pdf" | "image" | "audio" | "video" | "other";

const categorize = (mime: string): FileCategory => {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "other";
};

const categoryLabel: Record<FileCategory, string> = {
  pdf: "PDF",
  image: "Image",
  audio: "Audio",
  video: "Video",
  other: "File",
};

const categoryColor: Record<FileCategory, string> = {
  pdf: "bg-red-500/15 text-red-400",
  image: "bg-emerald-500/15 text-emerald-400",
  audio: "bg-violet-500/15 text-violet-400",
  video: "bg-blue-500/15 text-blue-400",
  other: "bg-white/10 text-muted",
};

const formatSize = (bytes: number) =>
  bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

const downloadUrl = (id: string) => `/api/materials/${id}/download`;

/* ---------------------------------------------------------------------------
 * MaterialPreview — inline preview based on file type
 * --------------------------------------------------------------------------- */

const MaterialPreview = ({ material }: { material: Material }) => {
  const cat = categorize(material.mime_type);
  const src = downloadUrl(material.id);

  switch (cat) {
    case "pdf":
      return (
        <div className="rounded-lg overflow-hidden bg-white/5 border border-white/[0.06]">
          <iframe
            src={src}
            className="w-full h-[70vh] min-h-[400px]"
            title={material.title}
          />
        </div>
      );
    case "image":
      return (
        <div className="rounded-lg overflow-hidden bg-white/5 border border-white/[0.06] flex items-center justify-center p-4">
          <img
            src={src}
            alt={material.title}
            className="max-w-full max-h-[70vh] object-contain rounded"
          />
        </div>
      );
    case "audio":
      return (
        <div className="rounded-lg bg-white/5 border border-white/[0.06] p-4">
          <audio controls preload="metadata" className="w-full">
            <source src={src} type={material.mime_type} />
          </audio>
        </div>
      );
    case "video":
      return (
        <div className="rounded-lg overflow-hidden bg-white/5 border border-white/[0.06]">
          <video controls preload="metadata" className="w-full max-h-[70vh]">
            <source src={src} type={material.mime_type} />
          </video>
        </div>
      );
    default:
      return (
        <div className="rounded-lg bg-white/5 border border-white/[0.06] p-6 text-center">
          <p className="text-muted text-sm">Preview not available for this file type.</p>
          <a
            href={src}
            download
            className="inline-block mt-3 text-sm text-accent hover:text-accent-hover transition-colors"
          >
            Download file
          </a>
        </div>
      );
  }
};

/* ---------------------------------------------------------------------------
 * MaterialCard — individual material row (expandable)
 * --------------------------------------------------------------------------- */

const MaterialCard = ({
  material,
  expanded,
  onToggle,
  admin,
  onDelete,
}: {
  material: Material;
  expanded: boolean;
  onToggle: () => void;
  admin: boolean;
  onDelete: () => void;
}) => {
  const cat = categorize(material.mime_type);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card overflow-hidden transition-colors hover:border-white/[0.1]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
        data-pwid="material-row"
      >
        {/* Type badge */}
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${categoryColor[cat]}`}>
          {categoryLabel[cat]}
        </span>

        {/* Title + filename */}
        <div className="flex-1 min-w-0">
          <span className="text-primary font-medium text-sm block truncate">{material.title}</span>
          <span className="text-muted/50 text-xs block truncate">{material.original_filename}</span>
        </div>

        {/* Size */}
        <span className="text-muted/40 text-xs shrink-0">{formatSize(material.file_size)}</span>

        {/* Expand chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={`text-muted/40 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded ? (
        <div className="px-4 pb-4 flex flex-col gap-3">
          <MaterialPreview material={material} />
          <div className="flex items-center gap-3">
            <a
              href={downloadUrl(material.id)}
              download
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
              data-pwid="material-download"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download
            </a>
            {admin ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="inline-flex items-center gap-1.5 text-xs text-red-400/70 hover:text-red-400 transition-colors cursor-pointer ml-auto"
                data-pwid="material-delete"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Delete
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

/* ---------------------------------------------------------------------------
 * LibraryPage
 * --------------------------------------------------------------------------- */

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
      const { data, error } = await api.admin.materials[id].delete();
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
