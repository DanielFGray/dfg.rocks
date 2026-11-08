import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import * as FileSystem from "effect/FileSystem";
import { Context, Effect, Layer, Redacted } from "effect";
import { env } from "../assertEnv.js";
import { createS3Client, makeS3ObjectStore, type S3Settings } from "./s3Objects.js";

export type StorageBackend = "local" | "s3";

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

/** The operations one backend offers, keyed by the storage key alone. */
interface KeyedStore {
  readonly exists: (storageKey: string) => Effect.Effect<boolean, unknown>;
  readonly put: (storageKey: string, bytes: Uint8Array) => Effect.Effect<void, unknown>;
  readonly delete: (storageKey: string) => Effect.Effect<void, unknown>;
  readonly open: (storageKey: string) => Effect.Effect<ReadableStream<Uint8Array>, unknown>;
}

const uploadsDir = env.UPLOADS_DIR || "./uploads";

/**
 * S3 is enabled only when all five variables are set. A partial set is a deploy mistake, so it
 * stops startup rather than writing new files to local disk.
 */
function readS3Settings(): S3Settings | undefined {
  const {
    S3_ENDPOINT: endpoint,
    S3_REGION: region,
    S3_BUCKET: bucket,
    S3_ACCESS_KEY_ID: accessKeyId,
    S3_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  if (
    endpoint === undefined &&
    region === undefined &&
    bucket === undefined &&
    accessKeyId === undefined &&
    secretAccessKey === undefined
  ) {
    return undefined;
  }
  if (
    endpoint === undefined ||
    region === undefined ||
    bucket === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined
  ) {
    throw new Error(
      "S3 storage is partly configured: set all of S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or none of them",
    );
  }
  return { endpoint, region, bucket, accessKeyId, secretAccessKey: Redacted.value(secretAccessKey) };
}

const s3Settings = readS3Settings();

/** Backend for files written from now on. A stored row keeps the backend it was written to. */
const newFileBackend: StorageBackend = s3Settings ? "s3" : "local";

function resolveLocalPath(storageKey: string): string {
  return path.isAbsolute(storageKey) ? storageKey : path.join(uploadsDir, storageKey);
}

function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

function makeLocalStore(fileSystem: FileSystem.FileSystem): KeyedStore {
  return {
    exists: (storageKey) => fileSystem.exists(resolveLocalPath(storageKey)),
    put: (storageKey, bytes) => {
      const filePath = resolveLocalPath(storageKey);
      return fileSystem
        .makeDirectory(path.dirname(filePath), { recursive: true })
        .pipe(Effect.andThen(fileSystem.writeFile(filePath, bytes)));
    },
    delete: (storageKey) => fileSystem.remove(resolveLocalPath(storageKey)),
    open: (storageKey) =>
      Effect.try({
        try: () =>
          Readable.toWeb(
            createReadStream(resolveLocalPath(storageKey)),
          ) as unknown as ReadableStream<Uint8Array>,
        catch: (error) => error,
      }),
  };
}

const makeLive = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const localStore = makeLocalStore(fileSystem);
  const s3Store = s3Settings ? makeS3ObjectStore(createS3Client(s3Settings)) : undefined;

  const storeFor = (location: StorageLocation): Effect.Effect<KeyedStore, Error> => {
    switch (location.storageBackend) {
      case "local":
        return Effect.succeed(localStore);
      case "s3":
        return s3Store
          ? Effect.succeed(s3Store)
          : Effect.fail(new Error("S3 storage is not configured"));
      default:
        return Effect.fail(new Error(`Unsupported storage backend: ${location.storageBackend}`));
    }
  };

  return {
    exists: (location) =>
      storeFor(location).pipe(Effect.flatMap((store) => store.exists(location.storageKey))),
    put: (location, bytes) =>
      storeFor(location).pipe(Effect.flatMap((store) => store.put(location.storageKey, bytes))),
    delete: (location) =>
      storeFor(location).pipe(Effect.flatMap((store) => store.delete(location.storageKey))),
    open: (location) =>
      storeFor(location).pipe(Effect.flatMap((store) => store.open(location.storageKey))),
  } satisfies StorageServiceShape;
});

const makeTest = Effect.sync(() => {
  const files = new Map<string, Uint8Array>();
  const keyOf = (location: StorageLocation) => `${location.storageBackend}:${location.storageKey}`;

  return {
    exists: (location) => Effect.sync(() => files.has(keyOf(location))),
    put: (location, bytes) =>
      Effect.sync(() => {
        files.set(keyOf(location), bytes.slice());
      }),
    delete: (location) =>
      Effect.sync(() => {
        files.delete(keyOf(location));
      }),
    open: (location) =>
      Effect.suspend(() => {
        const bytes = files.get(keyOf(location));
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
  } satisfies StorageServiceShape;
});

/**
 * Replaceable storage I/O. Provide either layer or layerTest at the application boundary.
 */
export class StorageService extends Context.Service<StorageService, StorageServiceShape>()(
  "StorageService",
) {
  static readonly layer = Layer.effect(this, makeLive);
  static readonly layerTest = Layer.effect(this, makeTest);

  static hashBytes(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  static createMaterialLocation(contentHash: string): StorageLocation {
    return {
      storageBackend: newFileBackend,
      storageKey: path.posix.join("materials", contentHash.slice(0, 2), contentHash),
    };
  }

  static createTestingLocation(filename: string): StorageLocation {
    return {
      storageBackend: newFileBackend,
      storageKey: path.posix.join("test", `${randomUUID()}${getExtension(filename)}`),
    };
  }
}
