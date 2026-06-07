import { Effect } from "effect";
import { useEffect, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { fetchAuthUser, libraryQuery } from "../../lib/queries.js";
import type { Material } from "../../../shared/schemas.js";
import { Button } from "../../components/ui/Button.js";
import { Modal } from "../../components/ui/Modal.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { MaterialCard } from "../../components/library/MaterialCard.js";
import { UploadMaterialForm } from "../../components/library/UploadMaterialForm.js";
import { Main } from "../../components/ui/Container.js";

export const Route = createFileRoute("/_authed/library")({
  beforeLoad: async ({ context }) => {
    const result = await fetchAuthUser(context.queryClient);
    if (result.user?.role !== "admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(libraryQuery),
  head: () => ({ meta: [{ title: "Library | DFG Portal" }] }),
  component: LibraryPage,
  pendingComponent: () => <Main className="text-muted dark:text-muted-dark">Loading...</Main>,
});

function LibraryPage() {
  const queryClient = useQueryClient();
  const { data: loaderMaterials } = useSuspenseQuery(libraryQuery);

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null);
  const [pendingCreated, setPendingCreated] = useState<Material[]>([]);
  const [pendingDeletedIds, setPendingDeletedIds] = useState<string[]>([]);

  const materials = [
    ...pendingCreated.filter(
      (item) =>
        !pendingDeletedIds.includes(item.id) &&
        !loaderMaterials.some((existing) => existing.id === item.id),
    ),
    ...loaderMaterials.filter((item) => !pendingDeletedIds.includes(item.id)),
  ];

  useEffect(() => {
    setPendingCreated((current) =>
      current.filter((item) => !loaderMaterials.some((existing) => existing.id === item.id)),
    );
    setPendingDeletedIds((current) =>
      current.filter((id) => loaderMaterials.some((item) => item.id === id)),
    );
  }, [loaderMaterials]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      Effect.runPromise(api.admin.deleteMaterial({ path: { id } })),
    onSuccess: (_, id) => {
      setDeleteTarget(null);
      setPendingCreated((current) => current.filter((item) => item.id !== id));
      setPendingDeletedIds((current) => [...current, id]);
      void queryClient.invalidateQueries({ queryKey: libraryQuery.queryKey });
    },
  });

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleUpload = (file: File, title: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    formData.append("is_global", "true");
    return Effect.runPromise(api.admin.uploadMaterial({ payload: formData }));
  };

  const handleUploadComplete = (uploadedMaterials: Material[], hadErrors: boolean) => {
    if (uploadedMaterials.length > 0) {
      const uploadedIds = new Set(uploadedMaterials.map((material) => material.id));
      setPendingCreated((current) => [
        ...uploadedMaterials,
        ...current.filter((item) => !uploadedIds.has(item.id)),
      ]);
      setPendingDeletedIds((current) => current.filter((id) => !uploadedIds.has(id)));
      void queryClient.invalidateQueries({ queryKey: libraryQuery.queryKey });
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

      {/* ---- Materials ---- */}
      {materials.length === 0 ? (
        <EmptyState
          message="No materials in the library yet. Upload your first file."
          action={{
            label: "Upload Material",
            onClick: () => setUploadModalOpen(true),
          }}
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
