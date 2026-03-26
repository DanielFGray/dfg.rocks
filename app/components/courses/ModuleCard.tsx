import type { Material, Module, ModuleWithMaterials } from "../../lib/types.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

export function ModuleCard({
  mod,
  isAdmin,
  onEdit,
  onDelete,
  onAttachMaterial,
  onDetachMaterial,
}: {
  mod: ModuleWithMaterials;
  isAdmin: boolean;
  onEdit: (mod: Module) => void;
  onDelete: (mod: Module) => void;
  onAttachMaterial: (moduleId: string) => void;
  onDetachMaterial: (moduleId: string, materialId: string) => void;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between mb-1">
        <h2 className="text-lg font-semibold text-primary">{mod.title}</h2>
        {isAdmin ? (
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <Button
              variant="ghost"
              onClick={() => onEdit(mod)}
              className="text-xs px-2 py-1"
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              onClick={() => onDelete(mod)}
              className="text-xs px-2 py-1 text-red-400 hover:text-red-300"
            >
              Delete
            </Button>
          </div>
        ) : null}
      </div>
      {mod.description ? (
        <p className="text-sm text-muted mb-4">{mod.description}</p>
      ) : null}
      {mod.materials.length === 0 ? (
        <p className="text-sm text-muted/60 italic">No materials yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 mt-3">
          {mod.materials.map((mat: Material) => (
            <li
              key={mat.id}
              className="flex items-center gap-3 rounded-lg bg-surface px-4 py-2.5 text-sm"
            >
              <span className="text-primary font-medium flex-1">
                {mat.title}
              </span>
              <span className="text-muted/60 text-xs">
                {mat.original_filename}
              </span>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => onDetachMaterial(mod.id, mat.id)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer ml-2"
                >
                  Detach
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {isAdmin ? (
        <div className="mt-3 pt-3 border-t border-white/[0.06]">
          <Button
            variant="ghost"
            className="text-xs px-2 py-1"
            onClick={() => onAttachMaterial(mod.id)}
          >
            + Attach Material
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
