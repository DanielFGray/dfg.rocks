import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import * as FileSystem from "effect/FileSystem";
import { Config, Context, Effect, Layer, Option, Redacted, Schema as S } from "effect";
import { createS3Client, makeS3ObjectStore, type S3Settings } from "./s3Objects.js";

export type StorageBackend = "local" | "s3";

export type StorageLocation = {
  storageBackend: string;
  storageKey: string;
};

interface StorageServiceShape {
  /** Where a new material blob goes. A stored row keeps the backend it was written to. */
  readonly materialLocation: (contentHash: string) => StorageLocation;
  readonly testingLocation: (filename: string) => StorageLocation;
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

/** Some S3 variables are set and some are not. */
export class StoragePartlyConfiguredError extends S.TaggedError<StoragePartlyConfiguredError>()(
  "StoragePartlyConfiguredError",
  { message: S.String },
) {}

const s3Config = Config.all({
  endpoint: Config.option(Config.NonEmptyString("S3_ENDPOINT")),
  region: Config.option(Config.NonEmptyString("S3_REGION")),
  bucket: Config.option(Config.NonEmptyString("S3_BUCKET")),
  accessKeyId: Config.option(Config.NonEmptyString("S3_ACCESS_KEY_ID")),
  secretAccessKey: Config.option(Config.Redacted("S3_SECRET_ACCESS_KEY")),
});

/**
 * S3 is enabled only when all five variables are set. A partial set is a deploy mistake, so it
 * stops startup rather than writing new files to local disk.
 */
const readS3Settings = Effect.gen(function* () {
  const s3 = yield* s3Config;
  const complete = Option.all(s3);
  if (Option.isSome(complete)) {
    const settings = complete.value;
    return Option.some({
      ...settings,
      secretAccessKey: Redacted.value(settings.secretAccessKey),
    } satisfies S3Settings);
  }
  if (Object.values(s3).every((value: Option.Option<unknown>) => Option.isNone(value))) {
    return Option.none<S3Settings>();
  }
  return yield* new StoragePartlyConfiguredError({
    message:
      "S3 storage is partly configured: set all of S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or none of them",
  });
});

function resolveLocalPath(uploadsDir: string, storageKey: string): string {
  return path.isAbsolute(storageKey) ? storageKey : path.join(uploadsDir, storageKey);
}

function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

function makeLocalStore(fileSystem: FileSystem.FileSystem, uploadsDir: string): KeyedStore {
  return {
    exists: (storageKey) => fileSystem.exists(resolveLocalPath(uploadsDir, storageKey)),
    put: (storageKey, bytes) => {
      const filePath = resolveLocalPath(uploadsDir, storageKey);
      return fileSystem
        .makeDirectory(path.dirname(filePath), { recursive: true })
        .pipe(Effect.andThen(fileSystem.writeFile(filePath, bytes)));
    },
    delete: (storageKey) => fileSystem.remove(resolveLocalPath(uploadsDir, storageKey)),
    open: (storageKey) =>
      Effect.try({
        try: () =>
          Readable.toWeb(
            createReadStream(resolveLocalPath(uploadsDir, storageKey)),
          ) as unknown as ReadableStream<Uint8Array>,
        catch: (error) => error,
      }),
  };
}

const makeLive = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const uploadsDir = yield* Config.NonEmptyString("UPLOADS_DIR").pipe(
    Config.withDefault("./uploads"),
  );
  const s3Settings = yield* readS3Settings;
  const localStore = makeLocalStore(fileSystem, uploadsDir);
  const s3Store = Option.map(s3Settings, (settings) => makeS3ObjectStore(createS3Client(settings)));

  const storeFor = (location: StorageLocation): Effect.Effect<KeyedStore, Error> => {
    switch (location.storageBackend) {
      case "local":
        return Effect.succeed(localStore);
      case "s3":
        return Option.match(s3Store, {
          onNone: () => Effect.fail(new Error("S3 storage is not configured")),
          onSome: Effect.succeed,
        });
      default:
        return Effect.fail(new Error(`Unsupported storage backend: ${location.storageBackend}`));
    }
  };

  return {
    ...makeLocations(Option.isSome(s3Settings) ? "s3" : "local"),
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
    ...makeLocations("local"),
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
}

function makeLocations(backend: StorageBackend) {
  return {
    materialLocation: (contentHash: string): StorageLocation => ({
      storageBackend: backend,
      storageKey: path.posix.join("materials", contentHash.slice(0, 2), contentHash),
    }),
    testingLocation: (filename: string): StorageLocation => ({
      storageBackend: backend,
      storageKey: path.posix.join("test", `${randomUUID()}${getExtension(filename)}`),
    }),
  };
}
