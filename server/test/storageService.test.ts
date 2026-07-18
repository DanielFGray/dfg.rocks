import { randomUUID } from "node:crypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { StorageService, type StorageLocation } from "../services/storageService.js";

const readBytes = (stream: ReadableStream<Uint8Array>) =>
  Effect.tryPromise({
    try: async () => new Uint8Array(await new Response(stream).arrayBuffer()),
    catch: (error) => error,
  });

const exerciseStorage = (location: StorageLocation) =>
  Effect.gen(function* () {
    const bytes = new Uint8Array([1, 2, 3, 255]);

    expect(yield* StorageService.exists(location)).toBe(false);
    yield* StorageService.put(location, bytes);
    expect(yield* StorageService.exists(location)).toBe(true);
    expect(yield* StorageService.open(location).pipe(Effect.flatMap(readBytes))).toEqual(bytes);
    yield* StorageService.delete(location);
    expect(yield* StorageService.exists(location)).toBe(false);
  });

describe("StorageService", () => {
  it.layer(StorageService.Test)((it) => {
    it.effect("provides replaceable in-memory storage through generated accessors", () =>
      exerciseStorage({ storageBackend: "local", storageKey: "test/in-memory.bin" }),
    );
  });

  it.layer(StorageService.Live.pipe(Layer.provide(NodeFileSystem.layer)))((it) => {
    it.effect("uses the platform filesystem and returns a web-readable Node stream", () =>
      exerciseStorage({
        storageBackend: "local",
        storageKey: `/tmp/dfg-storage-${randomUUID()}/nested/file.bin`,
      }),
    );
  });
});
