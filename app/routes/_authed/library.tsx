import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api, uploadMaterial } from "../../lib/api.js";
import type { Material } from "../../lib/types.js";
import { getLibraryPageData } from "../../lib/routeData.js";
import { Button } from "../../components/ui/Button.js";
import { Modal } from "../../components/ui/Modal.js";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { MaterialCard } from "../../components/library/MaterialCard.js";
import { UploadMaterialForm } from "../../components/library/UploadMaterialForm.js";

export const Route = createFileRoute("/_authed/library")({
  loader: () => getLibraryPageData(),
  head: () => ({ meta: [{ title: "Library | DFG Portal" }] }),
  component: LibraryPage,
  pendingComponent: () => (
    <main className="px-5 md:px-8 pt-20 pb-16 text-muted dark:text-muted-dark mx-auto max-w-[1100px]">
      Loading...
    </main>
  ),
});

function LibraryPage() {
  const router = useRouter();
  const { materials: loaderMaterials, isAdmin } = Route.useLoaderData();

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

  const uploadMutation = useMutation({
    mutationFn: async ({ file, title }: { file: File; title: string }) =>
      uploadMaterial(file, title, true),
    onSuccess: (material: Material) => {
      setUploadModalOpen(false);
      setPendingCreated((current) => [
        material,
        ...current.filter((item) => item.id !== material.id),
      ]);
      setPendingDeletedIds((current) => current.filter((id) => id !== material.id));
      void router.invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.admin.materials({ id }).delete();
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to delete material");
      }
      return data;
    },
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

  const handleUpload = (file: File, title: string) => {
    uploadMutation.mutate({ file, title });
  };

  return (
    <main data-testid="library" className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[1100px]">
      {/* ---- Header ---- */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Library</h1>
        {isAdmin ? (
          <Button onClick={() => setUploadModalOpen(true)} data-testid="upload-material">
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
              ? {
                  label: "Upload Material",
                  onClick: () => setUploadModalOpen(true),
                }
              : undefined
          }
        />
      ) : (
        <div className="gap-2 flex flex-col">
          {materials.map((m) => (
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
        <Modal
          open={uploadModalOpen}
          onClose={() => setUploadModalOpen(false)}
          title="Upload Material"
        >
          <UploadMaterialForm
            onSubmit={handleUpload}
            onCancel={() => setUploadModalOpen(false)}
            isPending={uploadMutation.isPending}
          />
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
