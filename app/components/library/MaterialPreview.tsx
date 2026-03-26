import type { Material } from "../../lib/types.js";
import { categorize, downloadUrl } from "./helpers.js";

export const MaterialPreview = ({ material }: { material: Material }) => {
  const cat = categorize(material.mime_type);
  const src = downloadUrl(material.id);

  switch (cat) {
    case "pdf":
      return (
        <div className="rounded-lg overflow-hidden bg-white/5 border border-white/[0.06]">
          <iframe
            src={src}
            className="w-full h-[70vh] min-h-[400px]"
            title={material.title}
          />
        </div>
      );
    case "image":
      return (
        <div className="rounded-lg overflow-hidden bg-white/5 border border-white/[0.06] flex items-center justify-center p-4">
          <img
            src={src}
            alt={material.title}
            className="max-w-full max-h-[70vh] object-contain rounded"
          />
        </div>
      );
    case "audio":
      return (
        <div className="rounded-lg bg-white/5 border border-white/[0.06] p-4">
          <audio controls preload="metadata" className="w-full">
            <source src={src} type={material.mime_type} />
          </audio>
        </div>
      );
    case "video":
      return (
        <div className="rounded-lg overflow-hidden bg-white/5 border border-white/[0.06]">
          <video controls preload="metadata" className="w-full max-h-[70vh]">
            <source src={src} type={material.mime_type} />
          </video>
        </div>
      );
    default:
      return (
        <div className="rounded-lg bg-white/5 border border-white/[0.06] p-6 text-center">
          <p className="text-muted text-sm">Preview not available for this file type.</p>
          <a
            href={src}
            download
            className="inline-block mt-3 text-sm text-accent hover:text-accent-hover transition-colors"
          >
            Download file
          </a>
        </div>
      );
  }
};
