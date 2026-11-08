import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { makeS3ObjectStore, type ObjectClient } from "../services/s3Objects.js";

/** In-memory stand-in for the subset of Bun's S3Client that makeS3ObjectStore calls. */
function fakeClient() {
  const objects = new Map<string, Uint8Array>();
  const client: ObjectClient = {
    file: (key) => ({
      exists: async () => objects.has(key),
      stream: () => {
        const bytes = objects.get(key);
        if (bytes === undefined) throw new Error(`no such key: ${key}`);
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.slice());
            controller.close();
          },
        });
      },
      write: async (bytes) => {
        objects.set(key, bytes.slice());
        return bytes.byteLength;
      },
      delete: async () => {
        objects.delete(key);
      },
    }),
  };
  return { client, objects };
}

describe("makeS3ObjectStore", () => {
  test("passes the storage key through unchanged and round-trips bytes", async () => {
    const { client, objects } = fakeClient();
    const store = makeS3ObjectStore(client);
    const key = "materials/ab/abcdef0123";
    const bytes = new Uint8Array([1, 2, 3, 250]);

    expect(await Effect.runPromise(store.exists(key))).toBe(false);
    await Effect.runPromise(store.put(key, bytes));
    expect([...objects.keys()]).toEqual([key]);
    expect(await Effect.runPromise(store.exists(key))).toBe(true);

    const stream = await Effect.runPromise(store.open(key));
    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(bytes);

    await Effect.runPromise(store.delete(key));
    expect(await Effect.runPromise(store.exists(key))).toBe(false);
  });

  test("reports a failed stream as a failed Effect instead of throwing", async () => {
    const store = makeS3ObjectStore(fakeClient().client);
    const result = await Effect.runPromise(Effect.result(store.open("missing/key")));
    expect(result._tag).toBe("Failure");
  });
});
