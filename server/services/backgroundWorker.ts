// @entrypoint: graphile-worker invokes jobs with the captured service context.
import { Config, Context, Effect, Layer, Redacted, Ref } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { getTasks, run, type Runner, type Task } from "graphile-worker";
import { WorkerTasks } from "../../worker/workerTasks.js";

export interface BackgroundWorkerShape {
  readonly isRunning: Effect.Effect<boolean>;
}

/**
 * The job runner. Only the server process builds this layer; tests and scripts that build the
 * application services do not, so they never run jobs.
 */
export class BackgroundWorker extends Context.Service<BackgroundWorker>()(
  "dfg-rocks/backgroundWorker",
  {
    make: Effect.gen(function* () {
      const workerDirectory = yield* Config.NonEmptyString("WORKER_DIR").pipe(
        Config.withDefault("worker"),
      );
      const runningRef = yield* Ref.make(false);
      yield* startRunner(workerDirectory, runningRef);
      return { isRunning: Ref.get(runningRef) };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(WorkerTasks.layer));
}

// Everything the runner holds is released in reverse order when the scope closes: the watcher,
// then the runner, then the task files and the delivery services the runner uses.
const startRunner = Effect.fnUntraced(function* (
  workerDirectory: string,
  runningRef: Ref.Ref<boolean>,
) {
  const connectionString = Redacted.value(yield* Config.Redacted("DATABASE_URL"));
  const services = yield* Effect.context<FileSystem | Path | WorkerTasks>();
  const path = yield* Path;
  const loaded = yield* Effect.acquireRelease(
    Effect.tryPromise(() => getTasks({}, path.join(workerDirectory, "tasks"))),
    (loaded) => Effect.sync(() => loaded.release()),
  );
  // graphile-worker retries a job whose task rejects, so a failed delivery must reject.
  const tasks = yield* WorkerTasks;
  const registered = Object.fromEntries(
    Object.entries(tasks).map(([name, task]): [string, Task] => {
      const deliver: Task = (payload, helpers) => {
        const effect: Effect.Effect<
          void,
          Effect.Error<ReturnType<typeof task>>,
          Effect.Services<ReturnType<typeof task>>
        > = task(payload);
        return Effect.runPromiseWith(services)(effect, { signal: helpers.abortSignal });
      };
      return [name, deliver];
    }),
  );
  const runner = yield* Effect.acquireRelease(
    Effect.tryPromise(() =>
      run({
        connectionString,
        // The signal handlers belong to the server, which closes this layer on SIGTERM and SIGINT.
        noHandleSignals: true,
        crontabFile: path.join(workerDirectory, "crontab"),
        taskList: { ...loaded.tasks, ...registered },
        // With the default delay (-1), graphile does not wait for the row
        // update that marks a job done or failed, and a graceful shutdown
        // can end the pool before it is sent. The job then stays locked
        // and runs again when the lock expires (4 hours), so a sent
        // email is sent twice. With a batch delay, the shutdown waits for
        // the pending updates; 0 sends each one on the next tick.
        preset: { worker: { completeJobBatchDelay: 0, failJobBatchDelay: 0 } },
      }),
    ),
    stopRunner(runningRef),
  );
  yield* Ref.set(runningRef, true);
  // Interrupted when the scope closes, before the runner is stopped, so a normal shutdown does not
  // log the runner's planned stop as an error.
  yield* Effect.tryPromise(() => runner.promise).pipe(
    Effect.catch((cause) => Effect.logError("Worker stopped with an error", cause)),
    Effect.andThen(Ref.set(runningRef, false)),
    Effect.forkScoped,
  );
});

// A runner that has settled stopped itself, and `stop` throws on a stopped runner, so it is skipped.
const stopRunner = (runningRef: Ref.Ref<boolean>) => (runner: Runner) =>
  Effect.gen(function* () {
    if (!(yield* Ref.get(runningRef))) return;
    yield* Effect.tryPromise(() => runner.stop()).pipe(
      Effect.catch((cause) => Effect.logError("Worker failed to stop", cause)),
    );
    yield* Ref.set(runningRef, false);
  });
