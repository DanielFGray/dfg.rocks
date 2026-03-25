import { treaty } from "@elysiajs/eden";
import type { App } from "../../server/app.js";

export const api = treaty<App>(
  typeof window !== "undefined" ? window.location.origin : "http://localhost",
  {
    fetch: { credentials: "include" },
    headers: { "X-Requested-With": "dfg" },
  },
).api;

// File upload (multipart — can't go through Eden)
export async function uploadMaterial(
  file: File,
  title: string,
  isGlobal: boolean,
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", title);
  formData.append("is_global", isGlobal ? "true" : "false");
  const res = await fetch("/api/admin/materials/upload", {
    method: "POST",
    body: formData,
    credentials: "include",
    headers: { "X-Requested-With": "dfg" },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: "Upload failed" }))) as { error?: string };
    throw new Error(data.error ?? "Upload failed");
  }
  return res.json();
}
