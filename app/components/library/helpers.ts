export type FileCategory = "pdf" | "image" | "audio" | "video" | "other";

export const categorize = (mime: string): FileCategory => {
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
  other: "File",
};

export const categoryColor: Record<FileCategory, string> = {
  pdf: "bg-red-500/15 text-red-400",
  image: "bg-emerald-500/15 text-emerald-400",
  audio: "bg-violet-500/15 text-violet-400",
  video: "bg-blue-500/15 text-blue-400",
  other: "bg-white/10 text-muted",
};

export const formatSize = (bytes: number) =>
  bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

export const downloadUrl = (id: string) => `/api/materials/${id}/download`;
