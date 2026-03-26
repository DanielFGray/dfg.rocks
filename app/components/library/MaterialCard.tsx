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
  const cat = categorize(material.mime_type);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card overflow-hidden transition-colors hover:border-white/[0.1]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
        data-pwid="material-row"
      >
        {/* Type badge */}
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${categoryColor[cat]}`}>
          {categoryLabel[cat]}
        </span>

        {/* Title + filename */}
        <div className="flex-1 min-w-0">
          <span className="text-primary font-medium text-sm block truncate">{material.title}</span>
          <span className="text-muted/50 text-xs block truncate">{material.original_filename}</span>
        </div>

        {/* Size */}
        <span className="text-muted/40 text-xs shrink-0">{formatSize(material.file_size)}</span>

        {/* Expand chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={`text-muted/40 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded ? (
        <div className="px-4 pb-4 flex flex-col gap-3">
          <MaterialPreview material={material} />
          <div className="flex items-center gap-3">
            <a
              href={downloadUrl(material.id)}
              download
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
              data-pwid="material-download"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download
            </a>
            {admin ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="inline-flex items-center gap-1.5 text-xs text-red-400/70 hover:text-red-400 transition-colors cursor-pointer ml-auto"
                data-pwid="material-delete"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
