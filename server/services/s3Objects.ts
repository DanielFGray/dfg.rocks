import { Effect } from "effect";

/** One object in a bucket. Bun's S3File has these methods; tests pass a fake with the same shape. */
export interface ObjectFile {
  exists(): Promise<boolean>;
  stream(): ReadableStream<Uint8Array>;
  write(bytes: Uint8Array): Promise<number>;
  delete(): Promise<void>;
}

export interface ObjectClient {
  file(key: string): ObjectFile;
}

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Creates a Bun S3 client. `Bun` exists only under Bun, so call this only when S3 is configured.
 * Path-style addressing (endpoint/bucket/key) is set explicitly because the object store has no
 * wildcard DNS for virtual-hosted bucket names.
 */
export function createS3Client(settings: S3Settings): ObjectClient {
  return new Bun.S3Client({ ...settings, virtualHostedStyle: false });
}

/** Keyed object operations over an S3 bucket. Keys are passed through unchanged. */
export function makeS3ObjectStore(client: ObjectClient) {
  return {
    exists: (key: string) => Effect.tryPromise(() => client.file(key).exists()),
    put: (key: string, bytes: Uint8Array) =>
      Effect.tryPromise(() => client.file(key).write(bytes)).pipe(Effect.asVoid),
    delete: (key: string) => Effect.tryPromise(() => client.file(key).delete()),
    // stream() does not contact the store. A missing key fails when the stream is read.
    open: (key: string) => Effect.try(() => client.file(key).stream()),
  };
}
