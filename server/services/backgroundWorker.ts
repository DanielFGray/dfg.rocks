import { Config, Context, Effect, Layer, Redacted, Ref, Scope } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { getTasks, run, type Runner, type Task } from "graphile-worker";
import { Mailer } from "../../worker/email/mailer.js";
import { sendEmail } from "../../worker/email/sendEmail.js";

export interface BackgroundWorkerShape {
  // A runner that fails to start is logged and reported through `failed`; the caller is not failed,
  // so the HTTP server keeps serving.
  // `workerDirectory` holds the runner's files: tasks/, crontab and templates/. The entry passes it,
  // because inside the server bundle no module sits next to those files.
  readonly start: (workerDirectory: string) => Effect.Effect<void>;
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
      const connectionString = Redacted.value(yield* Config.Redacted("DATABASE_URL"));
      const files = yield* Effect.context<FileSystem | Path>();
      const path = yield* Path;
      // Holds what a started runner uses: the Mailer and the loaded task files. It is made before
      // the finalizer below, so it closes after the runner has stopped.
      const runnerResources = yield* Scope.fork(yield* Effect.scope);
      const failedRef = yield* Ref.make(false);
      const runnerRef = yield* Ref.make<Runner | undefined>(undefined);
      const markFailed = Ref.set(failedRef, true);

      const startRunner = Effect.fnUntraced(function* (workerDirectory: string) {
        // Built here, not with the layer: a mail provider that cannot start stops only the worker.
        const mailer = yield* Layer.buildWithScope(Mailer.layer, runnerResources).pipe(
          Effect.provideContext(files),
        );
        const services = Context.merge(files, mailer);
        const loaded = yield* Effect.tryPromise(() =>
          getTasks({}, path.join(workerDirectory, "tasks")),
        );
        yield* Scope.addFinalizer(
          runnerResources,
          Effect.sync(() => loaded.release()),
        );
        // graphile-worker retries a job whose task rejects, so a failed delivery must reject.
        const templateDirectory = path.join(workerDirectory, "templates");
        const deliver: Task = (payload, helpers) =>
          Effect.runPromiseWith(services)(sendEmail(payload, templateDirectory), {
            signal: helpers.abortSignal,
          });
        return yield* Effect.tryPromise(() =>
          run({
            connectionString,
            // The signal handlers belong to the server, which stops the runner on SIGTERM and SIGINT.
            noHandleSignals: true,
            crontabFile: path.join(workerDirectory, "crontab"),
            taskList: { ...loaded.tasks, send_email: deliver },
          }),
        );
      });

      const start = Effect.fnUntraced(function* (workerDirectory: string) {
        const runner = yield* startRunner(workerDirectory).pipe(
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
