import { Effect } from "effect";
import { useEffect, useState } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { requireSession } from "../../lib/sessionGuards.server.js";
import { api } from "../../lib/api.js";
import type { Material } from "../../../shared/schemas.js";
import { runServerEffect } from "../../lib/serverEffect.js";
import { AuthenticatedRouteService } from "../../../server/services/authenticatedRouteService.js";
import { toServerFunctionPayload } from "../../lib/serverFunctionPayload.js";
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
      const session = yield* requireSession(token);
      if (session.user.role !== "admin") {
        return null;
      }
      const data = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
        authenticatedRouteService.library(session.session.id, {
          limit: 1000,
          offset: 0,
        }),
      );
      return toServerFunctionPayload(data) as Material[];
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

  const handleUpload = (file: File, title: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    formData.append("is_global", "true");
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
