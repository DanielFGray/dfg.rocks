import { lazy, Suspense } from "react";
import type { Material } from "../../../shared/schemas.js";
import { categorize, downloadUrl } from "./helpers.js";
import type { AlphaTabPlayerProps } from "../alphatab/AlphaTabPlayer.js";
import { StaticScoreFrame } from "gigbag.js/react";
import type { StaticScore } from "gigbag.js/static";

const AlphaTabPlayer = lazy(() =>
  import("../alphatab/AlphaTabPlayer.js").then((m) => ({
    default: m.AlphaTabPlayer,
  })),
);

const card =
  "rounded-lg overflow-hidden bg-overlay/5 border border-overlay/6";

export const MaterialPreview = ({
  material,
  embedded,
  staticScore,
  notationPlayerProps,
}: {
  material: Material;
  embedded?: boolean;
  /** A notation file drawn on the server: shown until the player has drawn, and in print. */
  staticScore?: StaticScore | null;
  notationPlayerProps?: Omit<AlphaTabPlayerProps, "source" | "staticScore">;
}) => {
  const cat = categorize(material.mime_type, material.original_filename);
  const src = downloadUrl(material.id);

  switch (cat) {
    case "pdf":
      return (
        <div className={embedded ? "overflow-hidden" : card}>
          <iframe src={src} className="h-[70vh] min-h-[400px] w-full" title={material.title} />
        </div>
      );
    case "image":
      return (
        <div
          className={
            embedded
              ? "flex items-center justify-center"
              : `${card} flex items-center justify-center p-4`
          }
        >
          <img
            src={src}
            alt={material.title}
            className="max-h-[70vh] max-w-full rounded-sm object-contain"
          />
        </div>
      );
    case "audio":
      return (
        <div className={embedded ? "" : `${card} p-4`}>
          <audio controls preload="metadata" className="w-full">
            <source src={src} type={material.mime_type} />
          </audio>
        </div>
      );
    case "video":
      return (
        <div className={embedded ? "overflow-hidden" : card}>
          <video controls preload="metadata" className="max-h-[70vh] w-full">
            <source src={src} type={material.mime_type} />
          </video>
        </div>
      );
    case "notation":
      return (
        <Suspense
          fallback={
            staticScore ? (
              <StaticScoreFrame score={staticScore} playerReady={false}>
                {null}
              </StaticScoreFrame>
            ) : (
              <div className="p-6 text-center text-sm text-muted">
                Loading...
              </div>
            )
          }
        >
          <AlphaTabPlayer
            source={{ url: src }}
            staticScore={staticScore}
            {...notationPlayerProps}
          />
        </Suspense>
      );
    default:
      return (
        <div className={embedded ? "text-center" : `${card} p-6 text-center`}>
          <p className="text-sm text-muted">
            Preview not available for this file type.
          </p>
          <a
            href={src}
            download
            className="mt-3 inline-block text-sm text-accent transition-colors hover:text-accent-hover"
          >
            Download file
          </a>
        </div>
      );
  }
};
