import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import { BackgroundWorker } from "../services/backgroundWorker.js";

describe("BackgroundWorker.layer", () => {
  // The server builds this layer before it listens. A runner that cannot start must not stop the
  // server, and /healthz reports it through `failed`.
  it.live(
    "builds, and reports failed, when the runner cannot start",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const dir = yield* fileSystem.makeTempDirectoryScoped();
        yield* fileSystem.writeFileString(`${dir}/crontab`, "not a crontab line\n");
        const services = yield* Layer.build(BackgroundWorker.layer(dir));
        expect(yield* Context.get(services, BackgroundWorker).failed).toBe(true);
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
    30_000,
  );
});
