import { Link } from "@tanstack/react-router";
import type { Module, ModuleWithMaterials } from "../../../shared/schemas.js";
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
    <div className="border-y border-overlay/6 bg-card px-3 py-5 md:rounded-xl md:border md:p-6 dark:border-overlay-dark/6 dark:bg-card-dark">
      <div className="mb-1 flex items-start justify-between">
        <h2 className="text-lg font-semibold text-primary dark:text-primary-dark">
          {mod.title}
        </h2>
        {isAdmin ? (
          <div className="ml-3 flex shrink-0 items-center gap-2">
            <Link
              to="/courses/$courseId/modules/$moduleId/edit"
              params={{ courseId, moduleId: mod.id }}
              className="no-underline"
            >
              <Button variant="ghost" className="px-2 py-1 text-xs">
                Edit
              </Button>
            </Link>
            <Button
              variant="ghost"
              onClick={() => onDelete(mod)}
              className="px-2 py-1 text-xs text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300"
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
        <p className="text-sm text-muted/60 italic dark:text-muted-dark/60">
          No content yet.
        </p>
      )}
    </div>
  );
}
