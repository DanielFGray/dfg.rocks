import { Effect } from "effect";
import { withAuthContext } from "../../../server/requestDatabase.js";
import { useState } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { Sessions } from "../../../server/services/sessions.js";
import { api } from "../../lib/api.js";
import type { ContentVisibility, Material } from "../../../shared/schemas.js";
import { runServerEffect } from "../../lib/serverEffect.js";
import { serializeLibraryMaterial } from "../../../shared/responseMappers.js";
import { Materials } from "../../../server/services/materials.js";
import { Button } from "../../components/ui/Button.js";
import { Modal } from "../../components/ui/Modal.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { MaterialCard } from "../../components/library/MaterialCard.js";
import { UploadMaterialForm } from "../../components/library/UploadMaterialForm.js";
import { Main } from "../../components/ui/Container.js";
import { SearchField } from "../../components/ui/SearchField.js";

const getLibraryPageData = createServerFn({ method: "GET" }).handler(() =>
  runServerEffect(
    Effect.gen(function* () {
      const token = getCookie("session");
      const session = yield* Sessions.use((sessions) => sessions.requireSession(token));
      if (session.user.role !== "admin") {
        return null;
      }
      const rows = yield* Materials.use((materialService) =>
        materialService
          .library({
            limit: 1000,
            offset: 0,
          })
          .pipe(withAuthContext(session.session.id)),
      );
      return rows.map(serializeLibraryMaterial);
    }),
  ),
);

export const Route = createFileRoute("/_authed/library")({
  loader: async () => {
    const materials = await getLibraryPageData();
    if (!materials) throw redirect({ to: "/dashboard" });
    return materials;
  },
  head: () => ({ meta: [{ title: "Library | DFG Portal" }] }),
  component: LibraryPage,
  pendingComponent: () => <Main className="text-muted dark:text-muted-dark">Loading...</Main>,
});

function LibraryPage() {
  const router = useRouter();
  const loaderMaterials = Route.useLoaderData();

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null);
  // Uploads and deletes shown before the loader runs again. The list below prefers the
  // loader's rows, so an entry the loader has caught up with has no effect.
  const [pendingCreated, setPendingCreated] = useState<Material[]>([]);
  const [pendingDeletedIds, setPendingDeletedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const rawMaterials = [
    ...pendingCreated.filter(
      (item) =>
        !pendingDeletedIds.includes(item.id) &&
        !loaderMaterials.some((existing) => existing.id === item.id),
    ),
    ...loaderMaterials.filter((item) => !pendingDeletedIds.includes(item.id)),
  ];

  const materials = searchQuery
    ? rawMaterials.filter(
        (m) =>
          m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.original_filename.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : rawMaterials;

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      Effect.runPromise(api.materialsAdmin.deleteMaterial({ params: { id } })),
    onSuccess: (_, id) => {
      setDeleteTarget(null);
      setPendingCreated((current) => current.filter((item) => item.id !== id));
      setPendingDeletedIds((current) => [...current, id]);
      void router.invalidate();
    },
  });

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleUpload = (file: File, title: string, visibility: ContentVisibility) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    formData.append("visibility", visibility);
    return Effect.runPromise(api.materialsAdmin.uploadMaterial({ payload: formData }));
  };

  const handleUploadComplete = (uploadedMaterials: Material[], hadErrors: boolean) => {
    if (uploadedMaterials.length > 0) {
      const uploadedIds = new Set(uploadedMaterials.map((material) => material.id));
      setPendingCreated((current) => [
        ...uploadedMaterials,
        ...current.filter((item) => !uploadedIds.has(item.id)),
      ]);
      setPendingDeletedIds((current) => current.filter((id) => !uploadedIds.has(id)));
      void router.invalidate();
    }

    if (!hadErrors) {
      setUploadModalOpen(false);
    }
  };

  return (
    <Main data-testid="library">
      {/* ---- Header ---- */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Library</h1>
        <Button onClick={() => setUploadModalOpen(true)} data-testid="upload-material">
          Upload Material
        </Button>
      </div>

      {/* ---- Search ---- */}
      <div className="mb-6">
        <SearchField
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by title or filename..."
          data-testid="library-search"
        />
      </div>

      {/* ---- Materials ---- */}
      {materials.length === 0 ? (
        <EmptyState
          message={
            searchQuery
              ? "No materials match your search."
              : "No materials in the library yet. Upload your first file."
          }
          action={
            searchQuery
              ? undefined
              : {
                  label: "Upload Material",
                  onClick: () => setUploadModalOpen(true),
                }
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {materials.map((m) => (
            <MaterialCard
              key={m.id}
              material={m}
              expanded={expandedId === m.id}
              onToggle={() => toggleExpand(m.id)}
              admin={true}
              onDelete={() => setDeleteTarget(m)}
            />
          ))}
        </div>
      )}

      {/* ---- Upload Modal ---- */}
      <Modal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        title="Upload Material"
        className="w-full max-w-3xl outline-hidden"
      >
        <UploadMaterialForm
          onUpload={handleUpload}
          onComplete={handleUploadComplete}
          onCancel={() => setUploadModalOpen(false)}
        />
      </Modal>

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
    </Main>
  );
}
