import type { Material } from "../../../shared/schemas.js";
import { MaterialPreview } from "./MaterialPreview.js";
import {
  categorize,
  categoryLabel,
  categoryColor,
  formatSize,
  downloadUrl,
} from "./helpers.js";

export const MaterialCard = ({
  material,
  expanded,
  onToggle,
  admin,
  onDelete,
}: {
  material: Material;
  expanded: boolean;
  onToggle: () => void;
  admin: boolean;
  onDelete: () => void;
}) => {
  const cat = categorize(material.mime_type, material.original_filename);

  return (
    <div
      className={`rounded-xl border border-overlay/6 bg-card transition-colors hover:border-overlay/10 dark:border-overlay-dark/6 dark:bg-card-dark dark:hover:border-overlay-dark/10 ${
        cat === "notation" && expanded
          ? "overflow-visible md:overflow-hidden"
          : "overflow-hidden"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-overlay/2 dark:hover:bg-overlay-dark/2"
        data-testid="material-row"
      >
        {/* Type badge */}
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wider uppercase ${categoryColor[cat]}`}
        >
          {categoryLabel[cat]}
        </span>

        {/* Title + filename */}
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-primary dark:text-primary-dark">
            {material.title}
          </span>
          <span className="block truncate text-xs text-muted/50 dark:text-muted-dark/50">
            {material.original_filename}
          </span>
        </div>

        {/* Size */}
        <span className="shrink-0 text-xs text-muted/40 dark:text-muted-dark/40">
          {formatSize(material.file_size)}
        </span>

        {/* Expand chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={`shrink-0 text-muted/40 transition-transform dark:text-muted-dark/40 ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded ? (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <MaterialPreview material={material} />
          <div className="flex items-center gap-3">
            <a
              href={downloadUrl(material.id)}
              download
              className="inline-flex items-center gap-1.5 text-xs text-accent transition-colors hover:text-accent-hover"
              data-testid="material-download"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download
            </a>
            {admin ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs text-red-600/70 transition-colors hover:text-red-600 dark:text-red-400/70 dark:hover:text-red-400"
                data-testid="material-delete"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Delete
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};
