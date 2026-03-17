import path from "path";
import { Effect } from "effect";
import { PgRootDB } from "../db.js";
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

export class FileServiceError {
  readonly _tag = "FileServiceError";
  constructor(
    readonly message: string,
    readonly status: number = 400,
  ) {}
}

export class FileService extends Effect.Service<FileService>()("FileService", {
  effect: Effect.gen(function* () {
    const db = yield* PgRootDB;
    const uploadsDir = env.UPLOADS_DIR || "./uploads";

    // Ensure uploads directory exists
    yield* Effect.promise(() => Bun.write(path.join(uploadsDir, ".keep"), ""));

    return {
      upload: (file: File, title: string, isGlobal: boolean, uploadedBy: string) =>
        Effect.gen(function* () {
          if (file.size > MAX_FILE_SIZE) {
            return yield* Effect.fail(
              new FileServiceError(`File too large. Maximum size is 50MB.`, 413),
            );
          }

          if (!isMimeAllowed(file.type)) {
            return yield* Effect.fail(
              new FileServiceError(
                `File type "${file.type}" is not allowed. Allowed: PDF, images, audio, video.`,
              ),
            );
          }

          const ext = getExtension(file.name);
          const storedName = `${crypto.randomUUID()}${ext}`;
          const filePath = path.join(uploadsDir, storedName);

          yield* Effect.promise(() => Bun.write(filePath, file));

          const material = yield* db
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
            .pipe(
              Effect.head,
              Effect.catchTag("NoSuchElementException", () =>
                Effect.die(new Error("Insert returned no rows")),
              ),
            );

          return material;
        }),

      download: (materialId: string, userId: string) =>
        Effect.gen(function* () {
          // Fetch the material record
          const material = yield* db
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
            .pipe(
              Effect.head,
              Effect.catchTag("NoSuchElementException", () =>
                Effect.fail(new FileServiceError("Material not found", 404)),
              ),
            );

          // Check access: admin can download anything
          const user = yield* db
            .selectFrom("app_public.users")
            .select(["id", "role"])
            .where("id", "=", userId)
            .pipe(
              Effect.head,
              Effect.catchTag("NoSuchElementException", () =>
                Effect.fail(new FileServiceError("User not found", 404)),
              ),
            );

          if (user.role !== "admin") {
            // Students can access global materials, materials assigned to them,
            // or materials in modules of courses they're enrolled in
            const hasAccess = yield* Effect.gen(function* () {
              if (material.is_global) return true;

              // Check student_materials
              const assigned = yield* db
                .selectFrom("app_public.student_materials")
                .select(["material_id"])
                .where("student_id", "=", userId)
                .where("material_id", "=", materialId)
                .pipe(
                  Effect.head,
                  Effect.map(() => true),
                  Effect.catchTag("NoSuchElementException", () =>
                    Effect.succeed(false),
                  ),
                );
              if (assigned) return true;

              // Check module_materials -> modules -> courses -> enrollments
              const enrolled = yield* db
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
                .pipe(
                  Effect.head,
                  Effect.map(() => true),
                  Effect.catchTag("NoSuchElementException", () =>
                    Effect.succeed(false),
                  ),
                );
              return enrolled;
            });

            if (!hasAccess) {
              return yield* Effect.fail(
                new FileServiceError("Access denied", 403),
              );
            }
          }

          // Verify file exists on disk
          const bunFile = Bun.file(material.file_path);
          const exists = yield* Effect.promise(() => bunFile.exists());
          if (!exists) {
            return yield* Effect.fail(
              new FileServiceError("File not found on disk", 404),
            );
          }

          return {
            path: material.file_path,
            filename: material.original_filename,
            mimeType: material.mime_type,
          };
        }),
    } as const;
  }),
  dependencies: [PgRootDB.Live],
  accessors: true,
}) {}
