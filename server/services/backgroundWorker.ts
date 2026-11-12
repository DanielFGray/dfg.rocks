import { Config, Context, Effect, Layer, Redacted, Ref } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as HttpClient from "effect/http/HttpClient";
import { getTasks, run, type Runner, type Task } from "graphile-worker";
import { Mailer } from "../../worker/email/mailer.js";
import { sendEmail } from "../../worker/email/sendEmail.js";
import { syncLessonEvent } from "../../worker/calendar/syncLessonEvent.js";
import { PgRootDB } from "../db.js";
import { GoogleCalendarService } from "./googleCalendarService.js";

/** The Effect tasks installed in addition to task files. */
export const effectTasks = (templateDirectory: string) => ({
  send_email: (payload: unknown) => sendEmail(payload, templateDirectory),
  lessons__sync_calendar_event: syncLessonEvent,
});

export interface BackgroundWorkerShape {
  readonly isRunning: Effect.Effect<boolean>;
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
   * A runner that fails to start fails this layer, so the HTTP server does not bind.
   */
  static readonly layer = (workerDirectory: string) =>
    Layer.effect(this, makeBackgroundWorker(workerDirectory));
}

const makeBackgroundWorker = Effect.fnUntraced(function* (workerDirectory: string) {
  const runningRef = yield* Ref.make(false);
  yield* startRunner(workerDirectory, runningRef);
  return { isRunning: Ref.get(runningRef) } satisfies BackgroundWorkerShape;
});

// Everything the runner holds is released in reverse order when the scope closes: the watcher,
// then the runner, then the task files and the Mailer the runner uses.
const startRunner = Effect.fnUntraced(function* (
  workerDirectory: string,
  runningRef: Ref.Ref<boolean>,
) {
  const connectionString = Redacted.value(yield* Config.Redacted("DATABASE_URL"));
  const files = yield* Effect.context<
    FileSystem | Path | PgRootDB | GoogleCalendarService | HttpClient.HttpClient
  >();
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
  const registered = Object.fromEntries(
    Object.entries(effectTasks(templateDirectory)).map(([name, task]): [string, Task] => {
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
  yield* Effect.tryPromise({ try: () => runner.promise, catch: (cause) => cause }).pipe(
    Effect.catch((cause) => Effect.logError("Worker stopped with an error", cause)),
    Effect.andThen(Ref.set(runningRef, false)),
    Effect.forkScoped,
  );
});

// A runner that has settled stopped itself, and `stop` throws on a stopped runner, so it is skipped.
const stopRunner = (runningRef: Ref.Ref<boolean>) => (runner: Runner) =>
  Effect.gen(function* () {
    if (!(yield* Ref.get(runningRef))) return;
    yield* Effect.tryPromise({ try: () => runner.stop(), catch: (cause) => cause }).pipe(
      Effect.catch((cause) => Effect.logError("Worker failed to stop", cause)),
    );
    yield* Ref.set(runningRef, false);
  });
