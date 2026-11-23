import { Effect } from "effect";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { ContentVisibility, Material } from "../../../shared/schemas.js";
import { Button } from "../ui/Button.js";
import { Modal } from "../ui/Modal.js";
import { UploadMaterialForm } from "../library/UploadMaterialForm.js";

export function AttachMaterialModal({
  open,
  title,
  availableMaterials,
  allMaterialsCount,
  onClose,
  onAttach,
  onUploaded,
}: {
  open: boolean;
  title: string;
  availableMaterials: Material[];
  allMaterialsCount: number;
  onClose: () => void;
  onAttach: (materialId: string) => void;
  onUploaded: (materials: Material[]) => void;
}) {
  const [showUpload, setShowUpload] = useState(false);
  const queryClient = useQueryClient();

  const handleClose = () => {
    setShowUpload(false);
    onClose();
  };

  const handleUpload = (file: File, title: string, visibility: ContentVisibility) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    formData.append("visibility", visibility);
    return Effect.runPromise(api.materialsAdmin.uploadMaterial({ payload: formData }));
  };

  const handleAttachMaterial = (materialId: string) => {
    onAttach(materialId);
  };

  const handleUploadComplete = (uploadedMaterials: Material[], hadErrors: boolean) => {
    if (uploadedMaterials.length > 0) {
      onUploaded(uploadedMaterials);
      void queryClient.invalidateQueries({ queryKey: ["library"] });
    }

    if (hadErrors) {
      return;
    }

    if (uploadedMaterials.length === 1) {
      setShowUpload(false);
      handleAttachMaterial(uploadedMaterials[0]!.id);
      return;
    }

    setShowUpload(false);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      className="w-full max-w-3xl outline-hidden"
    >
      {showUpload ? (
        <UploadMaterialForm
          onUpload={handleUpload}
          onComplete={handleUploadComplete}
          onCancel={() => setShowUpload(false)}
        />
      ) : (
        <>
          {availableMaterials.length === 0 && allMaterialsCount === 0 ? (
            <p className="py-4 text-center text-sm text-muted">
              No materials in the library yet.
            </p>
          ) : availableMaterials.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">
              All materials are already embedded.
            </p>
          ) : (
            <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {availableMaterials.map((mat) => (
                <Button
                  key={mat.id}
                  variant="ghost"
                  onClick={() => handleAttachMaterial(mat.id)}
                  className="flex items-center gap-3 rounded-lg border border-overlay/6 bg-surface px-4 py-3 text-left text-sm hover:border-accent/40 hover:bg-accent/5"
                >
                  <span className="flex-1 font-medium text-primary">
                    {mat.title}
                  </span>
                  <span className="text-xs text-muted/60">
                    {mat.original_filename}
                  </span>
                </Button>
              ))}
            </div>
          )}
          <div className="mt-4 flex justify-between">
            <Button variant="outline" onClick={() => setShowUpload(true)}>
              Upload New
            </Button>
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
