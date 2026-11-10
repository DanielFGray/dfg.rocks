/**
 * Runs the job runner on its own, for development, where the Vite server does not start it.
 * Production starts the same BackgroundWorker inside the server process (serve.ts).
 */
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Layer } from "effect";
import { Path } from "effect/Path";
import { BackgroundWorker } from "../server/services/backgroundWorker.js";

const program = Effect.gen(function* () {
  const path = yield* Path;
  const workerDir = yield* path.fromFileUrl(new URL(".", import.meta.url));
  const worker = yield* BackgroundWorker;
  yield* worker.start(workerDir);
  return yield* Effect.never;
});

BunRuntime.runMain(
  program.pipe(Effect.provide(BackgroundWorker.Live.pipe(Layer.provideMerge(BunServices.layer)))),
);
