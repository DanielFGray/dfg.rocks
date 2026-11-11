import { Config, Context, Effect, Layer, Redacted, Ref } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { getTasks, run, type Runner, type Task } from "graphile-worker";
import { Mailer } from "../../worker/email/mailer.js";
import { sendEmail } from "../../worker/email/sendEmail.js";

export interface BackgroundWorkerShape {
  // True once the runner has failed to start, or has stopped before its layer closed.
  readonly failed: Effect.Effect<boolean>;
}

/**
 * The job runner. Only the server process builds this layer; tests and scripts that build the
 * application services do not, so they never run jobs.
 */
export class BackgroundWorker extends Context.Service<BackgroundWorker, BackgroundWorkerShape>()(
  "BackgroundWorker",
) {
  /**
   * Starts the runner when the layer is built, and stops it when the layer's scope closes.
   * `workerDirectory` holds the runner's files: tasks/, crontab and templates/. The caller passes
   * it, because inside the server bundle no module sits next to those files.
   *
   * A runner that fails to start is logged and reported through `failed`, and the layer is still
   * built, so the HTTP server keeps serving.
   */
  static readonly layer = (workerDirectory: string) =>
    Layer.effect(this, makeBackgroundWorker(workerDirectory));
}

const makeBackgroundWorker = Effect.fnUntraced(function* (workerDirectory: string) {
  const failedRef = yield* Ref.make(false);
  const markFailed = Ref.set(failedRef, true);
  yield* startRunner(workerDirectory, failedRef).pipe(
    Effect.catch((cause) =>
      Effect.logError("Worker failed to start", cause).pipe(Effect.andThen(markFailed)),
    ),
  );
  return { failed: Ref.get(failedRef) } satisfies BackgroundWorkerShape;
});

// Everything the runner holds is released in reverse order when the scope closes: the watcher,
// then the runner, then the task files and the Mailer the runner uses.
const startRunner = Effect.fnUntraced(function* (
  workerDirectory: string,
  failedRef: Ref.Ref<boolean>,
) {
  const connectionString = Redacted.value(yield* Config.Redacted("DATABASE_URL"));
  const files = yield* Effect.context<FileSystem | Path>();
  const path = yield* Path;
  // Built here, not as a dependency of the layer: a mail provider that cannot start stops only the
  // worker.
  const mailer = yield* Layer.build(Mailer.layer);
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
        // The signal handlers belong to the server, which closes this layer on SIGTERM and SIGINT.
        noHandleSignals: true,
        crontabFile: path.join(workerDirectory, "crontab"),
        taskList: { ...loaded.tasks, send_email: deliver },
      }),
    ),
    stopRunner(failedRef),
  );
  // Interrupted when the scope closes, before the runner is stopped, so a normal shutdown does not
  // mark the runner failed.
  yield* Effect.tryPromise({ try: () => runner.promise, catch: (cause) => cause }).pipe(
    Effect.catch((cause) => Effect.logError("Worker stopped with an error", cause)),
    Effect.andThen(Ref.set(failedRef, true)),
    Effect.forkScoped,
  );
});

// A runner that has settled stopped itself, and `stop` throws on a stopped runner, so it is skipped.
const stopRunner = (failedRef: Ref.Ref<boolean>) => (runner: Runner) =>
  Effect.gen(function* () {
    if (yield* Ref.get(failedRef)) return;
    yield* Effect.tryPromise({ try: () => runner.stop(), catch: (cause) => cause }).pipe(
      Effect.catch((cause) => Effect.logError("Worker failed to stop", cause)),
    );
  });
