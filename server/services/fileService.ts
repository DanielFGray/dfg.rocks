import path from "node:path";
import { sql } from "kysely";
import { rootDb } from "../db.js";
import { HttpError } from "../pgErrors.js";
import { extractNotationTracksFromBytes } from "./notationService.js";
import { storageService, type StorageLocation } from "./storageService.js";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const ALLOWED_MIME_PATTERNS = ["application/pdf", /^image\//, /^audio\//, /^video\//] as const;

const NOTATION_EXTENSIONS = new Set([".gp", ".gp3", ".gp4", ".gp5", ".gpx", ".musicxml", ".mxl"]);

function isFileAllowed(mimeType: string, filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (NOTATION_EXTENSIONS.has(ext)) return true;
  return ALLOWED_MIME_PATTERNS.some((pattern) =>
    typeof pattern === "string" ? mimeType === pattern : pattern.test(mimeType),
  );
}

const MATERIAL_RESPONSE_COLUMNS = [
  "id",
  "title",
  "original_filename",
  "mime_type",
  "file_size",
  "is_global",
  "notation_tracks",
] as const;

type MaterialRecord = {
  id: string;
  title: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  is_global: boolean;
  notation_tracks: unknown;
};

type StoredMaterialRecord = MaterialRecord & {
  storage_backend: string;
  storage_key: string;
};

function toStorageLocation(
  material: Pick<StoredMaterialRecord, "storage_backend" | "storage_key">,
): StorageLocation {
  return {
    storageBackend: material.storage_backend,
    storageKey: material.storage_key,
  };
}

async function findMaterialByContentHash(
  contentHash: string,
): Promise<StoredMaterialRecord | null> {
  const material = await rootDb
    .selectFrom("app_public.materials")
    .select([...MATERIAL_RESPONSE_COLUMNS, "storage_backend", "storage_key"])
    .where("content_hash", "=", contentHash)
    .executeTakeFirst();

  return material ?? null;
}

function toMaterialResponse(material: MaterialRecord): MaterialRecord {
  return {
    id: material.id,
    title: material.title,
    original_filename: material.original_filename,
    mime_type: material.mime_type,
    file_size: material.file_size,
    is_global: material.is_global,
    notation_tracks: material.notation_tracks,
  };
}

async function ensureStoredBlob(material: StoredMaterialRecord, bytes: Uint8Array): Promise<void> {
  const location = toStorageLocation(material);
  const exists = await storageService.exists(location);
  if (!exists) {
    await storageService.put(location, bytes);
  }
}

export const fileService = {
  async upload(file: File, title: string, isGlobal: boolean, uploadedBy: string) {
    if (file.size > MAX_FILE_SIZE) {
      throw new HttpError(413, "File too large. Maximum size is 50MB.");
    }

    if (!isFileAllowed(file.type, file.name)) {
      throw new HttpError(
        400,
        `File type "${file.type}" is not allowed. Allowed: PDF, images, audio, video, notation files.`,
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentHash = storageService.hashBytes(buffer);
    const notationTracks = extractNotationTracksFromBytes(new Uint8Array(buffer), file.name);

    const existingMaterial = await findMaterialByContentHash(contentHash);
    if (existingMaterial) {
      await ensureStoredBlob(existingMaterial, buffer);
      return toMaterialResponse(existingMaterial);
    }

    const location = storageService.createMaterialLocation(contentHash);
    await storageService.put(location, buffer);

    try {
      const material = await rootDb
        .insertInto("app_public.materials")
        .values({
          title,
          original_filename: file.name,
          storage_backend: location.storageBackend,
          storage_key: location.storageKey,
          content_hash: contentHash,
          mime_type: file.type,
          file_size: buffer.byteLength,
          is_global: isGlobal,
          notation_tracks:
            notationTracks === null ? null : sql`${JSON.stringify(notationTracks)}::jsonb`,
          uploaded_by: uploadedBy,
        })
        .returning(MATERIAL_RESPONSE_COLUMNS)
        .executeTakeFirst();

      if (!material) {
        throw new Error("Insert returned no rows");
      }

      return material;
    } catch (error) {
      const cause = error as { code?: unknown; constraint?: unknown };
      if (cause.code === "23505" && cause.constraint === "materials_content_hash_key") {
        const concurrentMaterial = await findMaterialByContentHash(contentHash);
        if (concurrentMaterial) {
          await ensureStoredBlob(concurrentMaterial, buffer);
          return toMaterialResponse(concurrentMaterial);
        }
      }

      throw error;
    }
  },

  async download(materialId: string, userId: string) {
    // Fetch the material record
    const material = await rootDb
      .selectFrom("app_public.materials")
      .select([
        "id",
        "title",
        "original_filename",
        "storage_backend",
        "storage_key",
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
          .innerJoin("app_public.enrollments as e", "e.course_id", "mod.course_id")
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

    const location = toStorageLocation(material);
    if (!(await storageService.exists(location))) {
      throw new HttpError(500, "Material blob missing from storage");
    }

    return {
      stream: await storageService.open(location),
      filename: material.original_filename,
      mimeType: material.mime_type,
    };
  },
} as const;
