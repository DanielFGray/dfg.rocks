import { Context, Effect, Layer, Ref } from "effect";
import { run, type Runner } from "graphile-worker";
import { env } from "../assertEnv.js";

export interface WorkerPaths {
  readonly taskDirectory: string;
  readonly crontabFile: string;
}

export interface BackgroundWorkerShape {
  // A runner that fails to start is logged and reported through `failed`; the caller is not failed,
  // so the HTTP server keeps serving.
  readonly start: (paths: WorkerPaths) => Effect.Effect<void>;
  // True once a started runner has stopped or failed. A runner that was never started is not failed.
  readonly failed: Effect.Effect<boolean>;
}

// The job runner is started by `start`, not when the layer is built. Building the runtime happens in
// tests, seed scripts and dev servers, and none of them should run jobs.
export class BackgroundWorker extends Context.Service<BackgroundWorker, BackgroundWorkerShape>()(
  "BackgroundWorker",
) {
  static readonly Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const failedRef = yield* Ref.make(false);
      const runnerRef = yield* Ref.make<Runner | undefined>(undefined);
      const markFailed = Ref.set(failedRef, true);

      const start = Effect.fnUntraced(function* (paths: WorkerPaths) {
        const runner = yield* Effect.tryPromise({
          // The signal handlers belong to the server, which stops the runner on SIGTERM and SIGINT.
          try: () => run({ connectionString: env.DATABASE_URL, noHandleSignals: true, ...paths }),
          catch: (cause) => cause,
        }).pipe(
          Effect.catch((cause) =>
            Effect.logError("Worker failed to start", cause).pipe(
              Effect.andThen(markFailed),
              Effect.as(undefined),
            ),
          ),
        );
        if (!runner) return;

        yield* Ref.set(runnerRef, runner);
        // Detached, not scoped: `start` runs in a runtime call with no scope to attach it to. The fiber
        // ends when the runner's promise settles.
        yield* Effect.tryPromise({ try: () => runner.promise, catch: (cause) => cause }).pipe(
          Effect.catch((cause) => Effect.logError("Worker stopped with an error", cause)),
          Effect.andThen(markFailed),
          Effect.forkDetach,
        );
      });

      // Runs when the server runtime is disposed, before the database pools close. A runner that has
      // already settled stopped itself, and `stop` throws on a stopped runner, so it is skipped.
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const runner = yield* Ref.get(runnerRef);
          if (runner === undefined || (yield* Ref.get(failedRef))) return;
          yield* Effect.tryPromise({ try: () => runner.stop(), catch: (cause) => cause }).pipe(
            Effect.catch((cause) => Effect.logError("Worker failed to stop", cause)),
          );
        }),
      );

      return { start, failed: Ref.get(failedRef) } satisfies BackgroundWorkerShape;
    }),
  );
}
