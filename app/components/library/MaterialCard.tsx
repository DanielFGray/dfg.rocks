import type { Material } from "../../lib/types.js";
import { MaterialPreview } from "./MaterialPreview.js";
import { categorize, categoryLabel, categoryColor, formatSize, downloadUrl } from "./helpers.js";

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
      className={`rounded-xl border-overlay/6 bg-card hover:border-overlay/10 dark:border-overlay-dark/6 dark:bg-card-dark dark:hover:border-overlay-dark/10 border transition-colors ${
        cat === "notation" && expanded ? "md:overflow-hidden overflow-visible" : "overflow-hidden"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="gap-3 px-4 py-3 hover:bg-overlay/2 dark:hover:bg-overlay-dark/2 flex w-full cursor-pointer items-center text-left transition-colors"
        data-testid="material-row"
      >
        {/* Type badge */}
        <span
          className={`rounded-md px-2 py-0.5 font-semibold tracking-wider shrink-0 text-[11px] uppercase ${categoryColor[cat]}`}
        >
          {categoryLabel[cat]}
        </span>

        {/* Title + filename */}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-primary dark:text-primary-dark block truncate">
            {material.title}
          </span>
          <span className="text-xs text-muted/50 dark:text-muted-dark/50 block truncate">
            {material.original_filename}
          </span>
        </div>

        {/* Size */}
        <span className="text-xs text-muted/40 dark:text-muted-dark/40 shrink-0">
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
          className={`text-muted/40 dark:text-muted-dark/40 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded ? (
        <div className="gap-3 px-4 pb-4 flex flex-col">
          <MaterialPreview material={material} />
          <div className="gap-3 flex items-center">
            <a
              href={downloadUrl(material.id)}
              download
              className="gap-1.5 text-xs text-accent hover:text-accent-hover inline-flex items-center transition-colors"
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
                className="gap-1.5 text-xs text-red-600/70 hover:text-red-600 dark:text-red-400/70 dark:hover:text-red-400 ml-auto inline-flex cursor-pointer items-center transition-colors"
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
