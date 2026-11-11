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

// The job runner is started by `start`, not when the layer is built. Tests and seed scripts build the
// runtime too, and they must not run jobs.
export class BackgroundWorker extends Context.Service<BackgroundWorker, BackgroundWorkerShape>()(
  "BackgroundWorker",
) {
  static readonly Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const connectionString = Redacted.value(yield* Config.Redacted("DATABASE_URL"));
      const files = yield* Effect.context<FileSystem | Path>();
      const path = yield* Path;
      // Owns everything a started runner holds. A child of the layer's scope, so disposing the server
      // runtime closes it before the database pools, releasing in reverse order: the watcher, then
      // the runner, then the task files and the Mailer the runner uses.
      const runnerScope = yield* Scope.fork(yield* Effect.scope);
      const failedRef = yield* Ref.make(false);
      const markFailed = Ref.set(failedRef, true);

      const start = Effect.fnUntraced(
        function* (workerDirectory: string) {
          // Built here, not with the layer: a mail provider that cannot start stops only the worker.
          const mailer = yield* Layer.build(Mailer.layer).pipe(Effect.provideContext(files));
          const services = Context.merge(files, mailer);
          const loaded = yield* Effect.acquireRelease(
            Effect.tryPromise(() => getTasks({}, path.join(workerDirectory, "tasks"))),
            (loaded) => Effect.sync(() => loaded.release()),
          );
          // graphile-worker retries a job whose task rejects, so a failed delivery must reject.
          const templateDirectory = path.join(workerDirectory, "templates");
          const deliver: Task = (payload, helpers) =>
            Effect.runPromiseWith(services)(sendEmail(payload, templateDirectory), {
              signal: helpers.abortSignal,
            });
          const runner = yield* Effect.acquireRelease(
            Effect.tryPromise(() =>
              run({
                connectionString,
                // The signal handlers belong to the server, which stops the runner on SIGTERM and SIGINT.
                noHandleSignals: true,
                crontabFile: path.join(workerDirectory, "crontab"),
                taskList: { ...loaded.tasks, send_email: deliver },
              }),
            ),
            stopRunner(failedRef),
          );
          // Interrupted when the scope closes, before the runner is stopped, so a normal shutdown
          // does not mark the runner failed.
          yield* Effect.tryPromise({ try: () => runner.promise, catch: (cause) => cause }).pipe(
            Effect.catch((cause) => Effect.logError("Worker stopped with an error", cause)),
            Effect.andThen(markFailed),
            Effect.forkScoped,
          );
        },
        Scope.provide(runnerScope),
        Effect.catch((cause) =>
          Effect.logError("Worker failed to start", cause).pipe(Effect.andThen(markFailed)),
        ),
      );

      return { start, failed: Ref.get(failedRef) } satisfies BackgroundWorkerShape;
    }),
  );
}

// A runner that has settled stopped itself, and `stop` throws on a stopped runner, so it is skipped.
const stopRunner = (failedRef: Ref.Ref<boolean>) => (runner: Runner) =>
  Effect.gen(function* () {
    if (yield* Ref.get(failedRef)) return;
    yield* Effect.tryPromise({ try: () => runner.stop(), catch: (cause) => cause }).pipe(
      Effect.catch((cause) => Effect.logError("Worker failed to stop", cause)),
    );
  });
