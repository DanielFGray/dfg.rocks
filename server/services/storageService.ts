import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import * as FileSystem from "@effect/platform/FileSystem";
import { Effect, Layer } from "effect";
import { env } from "../assertEnv.js";

export type StorageBackend = "local";

export type StorageLocation = {
  storageBackend: string;
  storageKey: string;
};

interface StorageServiceShape {
  readonly exists: (location: StorageLocation) => Effect.Effect<boolean, unknown>;
  readonly put: (location: StorageLocation, bytes: Uint8Array) => Effect.Effect<void, unknown>;
  readonly delete: (location: StorageLocation) => Effect.Effect<void, unknown>;
  readonly open: (location: StorageLocation) => Effect.Effect<ReadableStream<Uint8Array>, unknown>;
}

const uploadsDir = env.UPLOADS_DIR || "./uploads";

function resolveLocalPath(storageKey: string): string {
  return path.isAbsolute(storageKey) ? storageKey : path.join(uploadsDir, storageKey);
}

function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

function localPath(location: StorageLocation): Effect.Effect<string, Error> {
  return location.storageBackend === "local"
    ? Effect.succeed(resolveLocalPath(location.storageKey))
    : Effect.fail(new Error(`Unsupported storage backend: ${location.storageBackend}`));
}

const makeLive = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;

  return {
    exists: (location) =>
      localPath(location).pipe(Effect.flatMap((filePath) => fileSystem.exists(filePath))),
    put: (location, bytes) =>
      localPath(location).pipe(
        Effect.flatMap((filePath) =>
          fileSystem
            .makeDirectory(path.dirname(filePath), { recursive: true })
            .pipe(Effect.zipRight(fileSystem.writeFile(filePath, bytes))),
        ),
      ),
    delete: (location) =>
      localPath(location).pipe(Effect.flatMap((filePath) => fileSystem.remove(filePath))),
    open: (location) =>
      localPath(location).pipe(
        Effect.flatMap((filePath) =>
          Effect.try({
            try: () =>
              Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream<Uint8Array>,
            catch: (error) => error,
          }),
        ),
      ),
  } satisfies StorageServiceShape;
});

const makeTest = Effect.sync(() => {
  const files = new Map<string, Uint8Array>();

  return {
    exists: (location) => localPath(location).pipe(Effect.map((filePath) => files.has(filePath))),
    put: (location, bytes) =>
      localPath(location).pipe(
        Effect.tap((filePath) => Effect.sync(() => files.set(filePath, bytes.slice()))),
        Effect.asVoid,
      ),
    delete: (location) =>
      localPath(location).pipe(
        Effect.tap((filePath) => Effect.sync(() => files.delete(filePath))),
        Effect.asVoid,
      ),
    open: (location) =>
      localPath(location).pipe(
        Effect.flatMap((filePath) => {
          const bytes = files.get(filePath);
          if (bytes === undefined) {
            return Effect.fail(new Error(`Stored file not found: ${location.storageKey}`));
          }
          return Effect.succeed(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(bytes.slice());
                controller.close();
              },
            }),
          );
        }),
      ),
  } satisfies StorageServiceShape;
});

/**
 * Replaceable storage I/O. Call operations through the generated static accessors
 * and provide either Live or Test at the application boundary.
 */
export class StorageService extends Effect.Tag("StorageService")<
  StorageService,
  StorageServiceShape
>() {
  static readonly Live = Layer.effect(this, makeLive);
  static readonly Test = Layer.effect(this, makeTest);

  static hashBytes(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  static createMaterialLocation(contentHash: string): StorageLocation {
    return {
      storageBackend: "local",
      storageKey: path.posix.join("materials", contentHash.slice(0, 2), contentHash),
    };
  }

  static createTestingLocation(filename: string): StorageLocation {
    return {
      storageBackend: "local",
      storageKey: path.posix.join("test", `${randomUUID()}${getExtension(filename)}`),
    };
  }
}
