export type FileCategory =
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "notation"
  | "other";

const NOTATION_EXTENSIONS = new Set([
  ".gp",
  ".gp3",
  ".gp4",
  ".gp5",
  ".gpx",
  ".musicxml",
  ".mxl",
]);

export function isNotation(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return NOTATION_EXTENSIONS.has(ext);
}

function normalizeTitleWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function titleFromFilename(filename: string): string {
  const basename = filename.split(/[/\\]/u).pop() ?? filename;
  const stem = basename.replace(/\.[^.]+$/u, "");
  return normalizeTitleWhitespace(stem.replace(/[._-]+/gu, " "));
}

export function getUploadMaterialTitle(
  filename: string,
  extractedScoreTitle: string | null | undefined,
): string {
  const normalizedScoreTitle = normalizeTitleWhitespace(
    extractedScoreTitle ?? "",
  );
  if (normalizedScoreTitle) {
    return normalizedScoreTitle;
  }

  return titleFromFilename(filename);
}

export const categorize = (mime: string, filename?: string): FileCategory => {
  if (filename && isNotation(filename)) return "notation";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "other";
};

export const categoryLabel: Record<FileCategory, string> = {
  pdf: "PDF",
  image: "Image",
  audio: "Audio",
  video: "Video",
  notation: "Notation",
  other: "File",
};

export const categoryColor: Record<FileCategory, string> = {
  pdf: "bg-red-500/15 text-red-600 dark:text-red-400",
  image: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  audio: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  video: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  notation: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  other:
    "bg-overlay/10 dark:bg-overlay-dark/10 text-muted dark:text-muted-dark",
};

export const formatSize = (bytes: number) =>
  bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

export const downloadUrl = (id: string) => `/api/materials/${id}/download`;
