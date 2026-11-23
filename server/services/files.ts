import path from "node:path";
import * as FileSystem from "effect/FileSystem";
import * as Multipart from "effect/http/Multipart";
import { sql } from "kysely";
import { Effect, Option, Context, Layer } from "effect";
import { RequestDatabase } from "../requestDatabase.js";
import { HttpError } from "../pgErrors.js";
import type { ContentVisibility } from "../../shared/schemas.js";
import { extractNotationTracksFromBytes } from "./notationService.js";
import { Storage, type StorageLocation } from "./storage.js";

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

type MaterialRecord = {
  id: string;
  title: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  visibility: ContentVisibility;
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

function toMaterialResponse(material: MaterialRecord): MaterialRecord {
  return {
    id: material.id,
    title: material.title,
    original_filename: material.original_filename,
    mime_type: material.mime_type,
    file_size: material.file_size,
    visibility: material.visibility,
    notation_tracks: material.notation_tracks,
  };
}

const findMaterialByContentHashEffect = Effect.fnUntraced(function* (contentHash: string) {
  return yield* RequestDatabase.use((db) =>
    db
      .execute(
        db
          .selectFrom("app_public.materials")
          .select((eb) => [
            "id",
            "title",
            "original_filename",
            "mime_type",
            eb.cast<number>("file_size", "integer").as("file_size"),
            "visibility",
            "notation_tracks",
            "storage_backend",
            "storage_key",
          ])
          .where("content_hash", "=", contentHash),
      )
      .pipe(Effect.head, Effect.option, Effect.map(Option.getOrUndefined)),
  );
});

/**
 * File upload / download service.
 */
export class Files extends Context.Service<Files>()("dfg-rocks/files", {
  make: Effect.gen(function* () {
    const storage = yield* Storage;
    const ensureStoredBlobEffect = Effect.fnUntraced(function* (
      material: StoredMaterialRecord,
      bytes: Uint8Array,
    ) {
      const location = toStorageLocation(material);
      const exists = yield* storage.exists(location);
      if (!exists) {
        yield* storage.put(location, bytes);
      }
    });
    const fileSystem = yield* FileSystem.FileSystem;
    return {
      upload: Effect.fn("fileUpload")(function* (
        file: File | Multipart.PersistedFile,
        title: string,
        visibility: ContentVisibility,
        uploadedBy: string,
      ) {
        let fileSize: number;
        let mimeType: string;
        let bytes: Uint8Array;
        if (Multipart.isPersistedFile(file)) {
          fileSize = Number(
            (yield* fileSystem
              .stat(file.path)
              .pipe(
                Effect.mapError(
                  () => new HttpError({ status: 400, message: "Failed to inspect uploaded file" }),
                ),
              )).size,
          );
          mimeType = file.contentType;
          bytes = yield* fileSystem
            .readFile(file.path)
            .pipe(
              Effect.mapError(
                () => new HttpError({ status: 400, message: "Failed to read uploaded file" }),
              ),
            );
        } else {
          fileSize = file.size;
          mimeType = file.type;
          bytes = new Uint8Array(
            yield* Effect.tryPromise({
              try: () => file.arrayBuffer(),
              catch: () => new HttpError({ status: 400, message: "Failed to read uploaded file" }),
            }),
          );
        }
        if (fileSize > MAX_FILE_SIZE) {
          return yield* new HttpError({
            status: 413,
            message: "File too large. Maximum size is 50MB.",
          });
        }
        if (!isFileAllowed(mimeType, file.name)) {
          return yield* new HttpError({
            status: 400,
            message: `File type "${mimeType}" is not allowed. Allowed: PDF, images, audio, video, notation files.`,
          });
        }
        const contentHash = Storage.hashBytes(bytes);
        const notationTracks = yield* extractNotationTracksFromBytes(bytes, file.name);
        const existingMaterial = yield* findMaterialByContentHashEffect(contentHash);
        if (existingMaterial) {
          yield* ensureStoredBlobEffect(existingMaterial, bytes);
          return yield* Effect.succeed(toMaterialResponse(existingMaterial));
        }
        const location = storage.materialLocation(contentHash);
        yield* storage.put(location, bytes);
        // Handle concurrent uploads with the same content hash (unique constraint race)
        return yield* RequestDatabase.use((db) =>
          db
            .execute(
              db
                .insertInto("app_public.materials")
                .values({
                  title,
                  original_filename: file.name,
                  storage_backend: location.storageBackend,
                  storage_key: location.storageKey,
                  content_hash: contentHash,
                  mime_type: mimeType,
                  file_size: bytes.byteLength,
                  visibility,
                  notation_tracks:
                    notationTracks === null ? null : sql`${JSON.stringify(notationTracks)}::jsonb`,
                  uploaded_by: uploadedBy,
                })
                .returning((eb) => [
                  "id",
                  "title",
                  "original_filename",
                  "mime_type",
                  eb.cast<number>("file_size", "integer").as("file_size"),
                  "visibility",
                  "notation_tracks",
                ]),
            )
            .pipe(
              Effect.catch(
                Effect.fnUntraced(function* (error: unknown) {
                  const cause = ((
                    error as {
                      cause?: unknown;
                    }
                  ).cause ?? error) as {
                    code?: unknown;
                    constraint?: unknown;
                  };
                  if (cause.code === "23505" && cause.constraint === "materials_content_hash_key") {
                    const concurrent = yield* findMaterialByContentHashEffect(contentHash);
                    if (concurrent) {
                      yield* ensureStoredBlobEffect(concurrent, bytes);
                      return [toMaterialResponse(concurrent)] as const;
                    }
                  }
                  return yield* Effect.fail(error);
                }),
              ),
              Effect.head,
            ),
        );
      }),

      // RLS on app_public.materials is the access check: a material the reader cannot read
      // is absent from this query and answers 404, the same as a material that does not exist.
      /**
       * Where a material's file is stored, for a visitor who may read the material: RLS
       * refuses the others with 404. Run it as the visitor, and read the file after the
       * transaction, because reading S3 is an HTTP call.
       */
      locate: Effect.fn("Files.locate")(function* (materialId: string) {
        const material = yield* RequestDatabase.use((db) =>
          db
            .execute(
              db
                .selectFrom("app_public.materials")
                .select(["storage_backend", "storage_key"])
                .where("id", "=", materialId),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () =>
                  new HttpError({ status: 404, message: "Material not found" }),
              }),
            ),
        );
        return toStorageLocation(material);
      }),

      download: Effect.fnUntraced(function* (materialId: string) {
        const material = yield* RequestDatabase.use((db) =>
          db
            .execute(
              db
                .selectFrom("app_public.materials")
                .select([
                  "id",
                  "title",
                  "original_filename",
                  "storage_backend",
                  "storage_key",
                  "mime_type",
                ])
                .where("id", "=", materialId),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () =>
                  new HttpError({ status: 404, message: "Material not found" }),
              }),
            ),
        );
        const location = toStorageLocation(material);
        const exists = yield* storage.exists(location);
        if (!exists) {
          return yield* new HttpError({
            status: 500,
            message: "Material blob missing from storage",
          });
        }
        const stream = yield* storage.open(location);
        return {
          stream,
          filename: material.original_filename,
          mimeType: material.mime_type,
        };
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(Storage.layer));
}
