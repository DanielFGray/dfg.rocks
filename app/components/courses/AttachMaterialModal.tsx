import type { Material } from "../../lib/types.js";
import { Button } from "../ui/Button.js";
import { Modal } from "../ui/Modal.js";

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
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {availableMaterials.length === 0 ? (
        <p className="text-muted text-sm py-4 text-center">
          {allMaterialsCount === 0
            ? "No materials in the library. Upload materials from the Library page first."
            : "All materials are already attached to this module."}
        </p>
      ) : (
        <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
          {availableMaterials.map((mat) => (
            <button
              key={mat.id}
              type="button"
              onClick={() => onAttach(mat.id)}
              className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-surface px-4 py-3 text-sm text-left transition-colors hover:border-accent/40 hover:bg-accent/5 cursor-pointer"
            >
              <span className="text-primary font-medium flex-1">
                {mat.title}
              </span>
              <span className="text-muted/60 text-xs">
                {mat.original_filename}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end mt-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
