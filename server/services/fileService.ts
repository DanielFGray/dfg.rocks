import fs from "fs/promises";
import path from "path";
import { rootDb } from "../db.js";
import { HttpError } from "../pgErrors.js";
import { env } from "../assertEnv.js";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const ALLOWED_MIME_PATTERNS = [
  "application/pdf",
  /^image\//,
  /^audio\//,
  /^video\//,
] as const;

function isMimeAllowed(mimeType: string): boolean {
  return ALLOWED_MIME_PATTERNS.some((pattern) =>
    typeof pattern === "string" ? mimeType === pattern : pattern.test(mimeType),
  );
}

function getExtension(filename: string): string {
  const ext = path.extname(filename);
  return ext || "";
}

const uploadsDir = env.UPLOADS_DIR || "./uploads";

// Ensure uploads directory exists
await fs.mkdir(uploadsDir, { recursive: true });

export const fileService = {
  async upload(file: File, title: string, isGlobal: boolean, uploadedBy: string) {
    if (file.size > MAX_FILE_SIZE) {
      throw new HttpError(413, "File too large. Maximum size is 50MB.");
    }

    if (!isMimeAllowed(file.type)) {
      throw new HttpError(
        400,
        `File type "${file.type}" is not allowed. Allowed: PDF, images, audio, video.`,
      );
    }

    const ext = getExtension(file.name);
    const storedName = `${crypto.randomUUID()}${ext}`;
    const filePath = path.join(uploadsDir, storedName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    const material = await rootDb
      .insertInto("app_public.materials")
      .values({
        title,
        original_filename: file.name,
        file_path: filePath,
        mime_type: file.type,
        file_size: file.size,
        is_global: isGlobal,
        uploaded_by: uploadedBy,
      })
      .returning([
        "id",
        "title",
        "original_filename",
        "mime_type",
        "file_size",
        "is_global",
      ])
      .executeTakeFirst();

    if (!material) {
      throw new Error("Insert returned no rows");
    }

    return material;
  },

  async download(materialId: string, userId: string) {
    // Fetch the material record
    const material = await rootDb
      .selectFrom("app_public.materials")
      .select([
        "id",
        "title",
        "original_filename",
        "file_path",
        "mime_type",
        "is_global",
        "uploaded_by",
      ])
      .where("id", "=", materialId)
      .executeTakeFirst();

    if (!material) {
      throw new HttpError(404, "Material not found");
    }

    // Check access: admin can download anything
    const user = await rootDb
      .selectFrom("app_public.users")
      .select(["id", "role"])
      .where("id", "=", userId)
      .executeTakeFirst();

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    if (user.role !== "admin") {
      // Students can access global materials, materials assigned to them,
      // or materials in modules of courses they're enrolled in
      let hasAccess = false;

      if (material.is_global) {
        hasAccess = true;
      }

      if (!hasAccess) {
        // Check student_materials
        const assigned = await rootDb
          .selectFrom("app_public.student_materials")
          .select(["material_id"])
          .where("student_id", "=", userId)
          .where("material_id", "=", materialId)
          .executeTakeFirst();
        if (assigned) hasAccess = true;
      }

      if (!hasAccess) {
        // Check module_materials -> modules -> courses -> enrollments
        const enrolled = await rootDb
          .selectFrom("app_public.module_materials as mm")
          .innerJoin("app_public.modules as mod", "mod.id", "mm.module_id")
          .innerJoin(
            "app_public.enrollments as e",
            "e.course_id",
            "mod.course_id",
          )
          .where("mm.material_id", "=", materialId)
          .where("e.student_id", "=", userId)
          .select(["mm.material_id"])
          .executeTakeFirst();
        if (enrolled) hasAccess = true;
      }

      if (!hasAccess) {
        throw new HttpError(403, "Access denied");
      }
    }

    // Verify file exists on disk
    try {
      await fs.access(material.file_path);
    } catch {
      throw new HttpError(404, "File not found on disk");
    }

    return {
      path: material.file_path,
      filename: material.original_filename,
      mimeType: material.mime_type,
    };
  },
} as const;
