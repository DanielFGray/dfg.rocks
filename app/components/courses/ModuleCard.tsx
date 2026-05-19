import { Link } from "@tanstack/react-router";
import type { Module, ModuleWithMaterials } from "../../lib/types.js";
import { ModuleContent } from "../editor/ModuleContent.js";
import { Button } from "../ui/Button.js";

export function ModuleCard({
  mod,
  courseId,
  isAdmin,
  onDelete,
}: {
  mod: ModuleWithMaterials;
  courseId: string;
  isAdmin: boolean;
  onDelete: (mod: Module) => void;
}) {
  return (
    <div className="md:border md:rounded-xl border-overlay/6 dark:border-overlay-dark/6 bg-card dark:bg-card-dark px-3 py-5 md:p-6 border-y">
      <div className="mb-1 flex items-start justify-between">
        <h2 className="text-lg font-semibold text-primary dark:text-primary-dark">{mod.title}</h2>
        {isAdmin ? (
          <div className="gap-2 ml-3 flex shrink-0 items-center">
            <Link
              to="/courses/$courseId/modules/$moduleId/edit"
              params={{ courseId, moduleId: mod.id }}
              className="no-underline"
            >
              <Button variant="ghost" className="text-xs px-2 py-1">
                Edit
              </Button>
            </Link>
            <Button
              variant="ghost"
              onClick={() => onDelete(mod)}
              className="text-xs px-2 py-1 text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300"
            >
              Delete
            </Button>
          </div>
        ) : null}
      </div>
      {mod.content ? (
        <div className="mt-3">
          <ModuleContent content={mod.content} materials={mod.materials} />
        </div>
      ) : (
        <p className="text-sm text-muted/60 dark:text-muted-dark/60 italic">No content yet.</p>
      )}
    </div>
  );
}
