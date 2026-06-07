import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Effect } from "effect";
import { env } from "../assertEnv.js";

export type StorageBackend = "local";

export type StorageLocation = {
  storageBackend: string;
  storageKey: string;
};

const uploadsDir = env.UPLOADS_DIR || "./uploads";

function resolveLocalPath(storageKey: string): string {
  return path.isAbsolute(storageKey)
    ? storageKey
    : path.join(uploadsDir, storageKey);
}

function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

function assertLocal(location: StorageLocation): void {
  if (location.storageBackend !== "local") {
    throw new Error(`Unsupported storage backend: ${location.storageBackend}`);
  }
}

const existsEffect = Effect.fnUntraced(function* (location: StorageLocation) {
  assertLocal(location);
  return yield* Effect.tryPromise({
    try: () =>
      fs
        .access(resolveLocalPath(location.storageKey))
        .then(() => true as const),
    catch: (error) => error,
  }).pipe(
    Effect.catchAll((error) => {
      const code = (error as { code?: string }).code;
      return code === "ENOENT"
        ? Effect.succeed(false as const)
        : Effect.fail(error);
    }),
  );
});

const putEffect = Effect.fnUntraced(function* (
  location: StorageLocation,
  bytes: Uint8Array,
) {
  assertLocal(location);
  const filePath = resolveLocalPath(location.storageKey);
  yield* Effect.tryPromise({
    // Creates the directory path (including uploadsDir) on first write
    try: () => fs.mkdir(path.dirname(filePath), { recursive: true }),
    catch: (error) => error,
  });
  yield* Effect.tryPromise({
    try: () => fs.writeFile(filePath, bytes),
    catch: (error) => error,
  });
});

const deleteEffect = Effect.fnUntraced(function* (location: StorageLocation) {
  assertLocal(location);
  yield* Effect.tryPromise({
    try: () => fs.unlink(resolveLocalPath(location.storageKey)),
    catch: (error) => error,
  });
});

const openEffect = Effect.fnUntraced(function* (location: StorageLocation) {
  assertLocal(location);
  return yield* Effect.try({
    try: () => {
      const nodeStream = createReadStream(
        resolveLocalPath(location.storageKey),
      );
      return Readable.toWeb(
        nodeStream,
      ) as unknown as ReadableStream<Uint8Array>;
    },
    catch: (error) => error,
  });
});

/**
 * Local filesystem storage service. Sync helpers (hashBytes, createMaterialLocation,
 * createTestingLocation) are plain functions; IO operations return Effects.
 * The top-level mkdir is removed — putEffect creates directories on first write.
 */
export class StorageService extends Effect.Service<StorageService>()(
  "StorageService",
  {
    sync: () => ({
      hashBytes: (bytes: Uint8Array) =>
        createHash("sha256").update(bytes).digest("hex"),
      createMaterialLocation: (contentHash: string): StorageLocation => ({
        storageBackend: "local",
        storageKey: path.posix.join(
          "materials",
          contentHash.slice(0, 2),
          contentHash,
        ),
      }),
      createTestingLocation: (filename: string): StorageLocation => ({
        storageBackend: "local",
        storageKey: path.posix.join(
          "test",
          `${randomUUID()}${getExtension(filename)}`,
        ),
      }),
      exists: existsEffect,
      put: putEffect,
      delete: deleteEffect,
      open: openEffect,
    }),
  },
) {
  static hashBytes(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  static createMaterialLocation(contentHash: string): StorageLocation {
    return {
      storageBackend: "local",
      storageKey: path.posix.join(
        "materials",
        contentHash.slice(0, 2),
        contentHash,
      ),
    };
  }

  static createTestingLocation(filename: string): StorageLocation {
    return {
      storageBackend: "local",
      storageKey: path.posix.join(
        "test",
        `${randomUUID()}${getExtension(filename)}`,
      ),
    };
  }

  static readonly exists = existsEffect;
  static readonly put = putEffect;
  static readonly delete = deleteEffect;
  static readonly open = openEffect;
}
