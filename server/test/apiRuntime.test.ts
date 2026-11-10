import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import { disposeApiHandler, handleApiRequest, startWorker } from "../app.js";

const healthz = Effect.promise(async () => {
  const response = await handleApiRequest(new Request("http://localhost/healthz"));
  return { status: response.status, body: await response.json() };
});

/**
 * Server functions and the production entry use serverRuntime; /api uses the handler in app.ts.
 * Both must reach the same services. The worker is started through serverRuntime with a crontab
 * that does not parse, so only a shared BackgroundWorker lets /healthz report the failure.
 */
describe("API handler and server runtime", () => {
  it.live(
    "share one worker, and dispose together",
    () =>
      Effect.gen(function* () {
        const before = yield* healthz;
        expect(before.status).toBe(200);

        const fileSystem = yield* FileSystem.FileSystem;
        const dir = yield* fileSystem.makeTempDirectoryScoped();
        yield* fileSystem.writeFileString(`${dir}/crontab`, "not a crontab line\n");
        yield* Effect.promise(() => startWorker(dir));

        const after = yield* healthz;
        expect(after.status).toBe(503);
        expect(after.body).toMatchObject({ failed: ["worker"] });

        yield* Effect.promise(disposeApiHandler);
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
    30_000,
  );
});
