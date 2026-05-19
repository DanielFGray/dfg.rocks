import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadMaterial } from "../../lib/api.js";
import type { Material } from "../../lib/types.js";
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
}: {
  open: boolean;
  title: string;
  availableMaterials: Material[];
  allMaterialsCount: number;
  onClose: () => void;
  onAttach: (materialId: string) => void;
}) {
  const [showUpload, setShowUpload] = useState(false);
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async ({ file, title }: { file: File; title: string }) =>
      uploadMaterial(file, title, true),
    onSuccess: (data: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
      setShowUpload(false);
      onAttach(data.id);
    },
  });

  const handleClose = () => {
    setShowUpload(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      {showUpload ? (
        <UploadMaterialForm
          onSubmit={(file, title) => uploadMutation.mutate({ file, title })}
          onCancel={() => setShowUpload(false)}
          isPending={uploadMutation.isPending}
        />
      ) : (
        <>
          {availableMaterials.length === 0 && allMaterialsCount === 0 ? (
            <p className="text-muted dark:text-muted-dark text-sm py-4 text-center">
              No materials in the library yet.
            </p>
          ) : availableMaterials.length === 0 ? (
            <p className="text-muted dark:text-muted-dark text-sm py-4 text-center">
              All materials are already embedded.
            </p>
          ) : (
            <div className="gap-2 max-h-80 flex flex-col overflow-y-auto">
              {availableMaterials.map((mat) => (
                <button
                  key={mat.id}
                  type="button"
                  onClick={() => onAttach(mat.id)}
                  className="gap-3 rounded-lg border-overlay/6 dark:border-overlay-dark/6 bg-surface dark:bg-surface-dark px-4 py-3 text-sm hover:border-accent/40 hover:bg-accent/5 flex cursor-pointer items-center border text-left transition-colors"
                >
                  <span className="text-primary dark:text-primary-dark font-medium flex-1">
                    {mat.title}
                  </span>
                  <span className="text-muted/60 dark:text-muted-dark/60 text-xs">
                    {mat.original_filename}
                  </span>
                </button>
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
