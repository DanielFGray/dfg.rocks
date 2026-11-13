// @entrypoint: graphile-worker calls the tasks and the logger, which run with the worker's context.
import {
  Cause,
  Config,
  Context,
  Effect,
  Layer,
  Option,
  Record,
  Redacted,
  Ref,
  Schema,
} from "effect";
import { Path } from "effect/Path";
import { type JobHelpers, Logger, run, type Runner } from "graphile-worker";

import {
  AccountMail,
  AuditEvent,
  DeleteAccount,
  ForgotPassword,
  ForgotPasswordUnregistered,
  MagicLink,
  SendVerification,
} from "./accountMail.js";
import { EmailDelivery, QueuedEmail } from "./email/emailDelivery.js";
import { WorkerDirectory } from "./config.js";
import { CalendarSync, CalendarSyncJob } from "./calendar/calendarSync.js";
import { BillingLedger } from "../server/services/billingLedger.js";
import { RecurringSchedule, PrepaidPeriod } from "../server/services/recurringSchedule.js";
import { Families, SendInvitation } from "../server/services/families.js";
import { TestimonialReminder } from "../server/services/testimonialReminder.js";
import { PgRootDB } from "../server/db.js";

class WorkerError extends Schema.TaggedError<WorkerError, { readonly brand: unique symbol }>()(
  "WorkerError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class WorkerJobs extends Context.Service<WorkerJobs>()("dfg-rocks/worker/WorkerJobs", {
  /** The decoded job list shared by the runner and its integration tests. */
  make: Effect.gen(function* () {
    const mail = yield* AccountMail;
    const delivery = yield* EmailDelivery;
    const calendar = yield* CalendarSync;
    const billing = yield* BillingLedger;
    const recurring = yield* RecurringSchedule;
    const families = yield* Families;
    const reminders = yield* TestimonialReminder;
    const context = yield* Effect.context<PgRootDB>();
    const task = taskIn(context);
    const empty = Schema.Struct({});
    return {
      send_email: task(QueuedEmail, delivery.send),
      lessons__sync_calendar_event: task(CalendarSyncJob, calendar.sync),
      user__audit: task(AuditEvent, (event, helpers) => mail.audit(event, helpers.job.created_at)),
      user__forgot_password: task(ForgotPassword, mail.forgotPassword),
      user__magic_link: task(MagicLink, mail.magicLink),
      user__forgot_password_unregistered_email: task(
        ForgotPasswordUnregistered,
        mail.forgotPasswordUnregistered,
      ),
      user__send_delete_account_email: task(DeleteAccount, mail.sendDeleteAccount),
      user_emails__send_verification: task(SendVerification, mail.sendVerification),
      family_invitations__send_invite: task(SendInvitation, families.sendInvitation),
      bills__issue_monthly: task(empty, () => billing.issueMonthly().pipe(Effect.asVoid)),
      lessons__generate_prepaid_period: task(PrepaidPeriod, recurring.generatePrepaidPeriod),
      testimonials__reminder_sweep: task(empty, () => reminders.sweep()),
      gcal__sync: task(empty, () => calendar.poll()),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(
      Layer.mergeAll(
        AccountMail.layer,
        EmailDelivery.layer,
        CalendarSync.layer,
        BillingLedger.layer,
        RecurringSchedule.layer,
        Families.layer,
        TestimonialReminder.layer,
        PgRootDB.layer,
      ),
    ),
  );
}

/**
 * The graphile-worker runner, inside the server process. Building the layer
 * starts the runner before the server binds, so `/healthz` cannot race runner
 * startup. A runner that cannot start fails this layer, so the server does not
 * bind. Job processing stays in the background, and `isRunning` lets
 * `/healthz` report if the runner stops after startup.
 *
 * The runner stops when the layer's scope closes, before the RateLimiter and
 * platform services its jobs use are released.
 */
export class Worker extends Context.Service<Worker>()("dfg-rocks/worker", {
  make: Effect.gen(function* () {
    const running = yield* Ref.make(false);
    yield* start(running);
    return { isRunning: Ref.get(running) };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(WorkerJobs.layer));
}

/**
 * Starts the runner and returns once it runs. A mail provider that cannot
 * start fails Worker.layer, so it stops the server.
 */
const start = Effect.fnUntraced(function* (running: Ref.Ref<boolean>) {
  const connection = yield* Config.Redacted("DATABASE_URL");
  const path = yield* Path;
  const workerDir = yield* WorkerDirectory;
  const context = yield* Effect.context();
  const taskList = yield* WorkerJobs;
  const logger = new Logger(
    (scope) => (level, message) =>
      Option.match(Record.get(graphileLevels, level), {
        onNone: () => undefined,
        onSome: (log) => Effect.runSyncWith(context)(log(message).pipe(Effect.annotateLogs(scope))),
      }),
  );
  const runner = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        run({
          connectionString: Redacted.value(connection),
          taskList,
          logger,
          crontabFile: path.join(workerDir, "crontab"),
          // The server's runtime handles SIGTERM and closes this scope.
          noHandleSignals: true,
          // With the default delay (-1), graphile does not wait for the row
          // update that marks a job done or failed, and a graceful shutdown
          // can end the pool before it is sent. The job then stays locked
          // and runs again when the lock expires (4 hours), so a sent
          // email is sent twice. With a batch delay, the shutdown waits for
          // the pending updates; 0 sends each one on the next tick.
          preset: { worker: { completeJobBatchDelay: 0, failJobBatchDelay: 0 } },
        }),
      catch: (cause) => new WorkerError({ message: "Could not start the worker", cause }),
    }),
    (started) => stop(started, running),
  );
  yield* Ref.set(running, true);
  // Forked after the release above, so on shutdown it is interrupted before
  // `stop` settles the runner's promise, and does not log a planned stop.
  yield* Effect.forkScoped(
    Effect.tryPromise({
      try: () => runner.promise,
      catch: (cause) => new WorkerError({ message: "The worker stopped with an error", cause }),
    }).pipe(
      Effect.matchEffect({
        onFailure: (error) => Effect.logError(error.message, error.cause),
        onSuccess: () => Effect.logError("The worker stopped"),
      }),
      Effect.andThen(Ref.set(running, false)),
    ),
  );
});

/** `runner.stop()` rejects on a runner that already stopped itself, so that one is skipped. */
const stop = Effect.fnUntraced(function* (runner: Runner, running: Ref.Ref<boolean>) {
  if (!(yield* Ref.get(running))) return;
  yield* Effect.tryPromise({
    try: () => runner.stop(),
    catch: (cause) => new WorkerError({ message: "Could not stop the worker", cause }),
  }).pipe(Effect.catch((error) => Effect.logError(error.message, error.cause)));
  yield* Ref.set(running, false);
});

/** The parts of graphile's `JobHelpers` that a job and its span read. */
export type JobRun = Pick<JobHelpers, "abortSignal"> & {
  readonly job: Pick<JobHelpers["job"], "id" | "task_identifier" | "attempts" | "created_at">;
};

/**
 * Makes graphile tasks that run their job in `context`, inside its Worker.job
 * span. Graphile owns retry scheduling: a failed job rejects its callback, and
 * a job stops when graphile aborts it.
 *
 * A job runs on its payload decoded with `schema`. The SQL that queues a job is
 * its payload's only producer, so a payload that does not decode is a bug
 * there, and the job fails.
 */
export const taskIn =
  <R>(context: Context.Context<R>) =>
  <S extends Schema.Decoder<unknown>, E>(
    schema: S,
    job: (payload: S["Type"], helpers: JobRun) => Effect.Effect<void, E, R>,
  ) =>
  (payload: unknown, helpers: JobRun): Promise<void> =>
    Effect.runPromiseWith(context)(
      traced(
        Schema.decodeUnknownEffect(schema)(payload).pipe(
          Effect.flatMap((decodedPayload) => job(decodedPayload, helpers)),
        ),
        helpers,
      ),
      { signal: helpers.abortSignal },
    );

/**
 * Runs one job in its Worker.job span. This is the worker's failure boundary:
 * a failure is logged here, once, inside the span, so the line carries the
 * trace id. A stop is not a failure, so an interrupt alone is not logged.
 */
const traced = <A, E, R>(job: Effect.Effect<A, E, R>, helpers: JobRun) =>
  job.pipe(
    Effect.tapCauseIf(
      (cause) => !Cause.hasInterruptsOnly(cause),
      (cause) => Effect.logError("The job failed", cause),
    ),
    Effect.withSpan("Worker.job", {
      attributes: {
        "job.task": helpers.job.task_identifier,
        "job.id": helpers.job.id,
        "job.attempt": helpers.job.attempts,
      },
    }),
  );

/**
 * Graphile's log levels, as Effect log calls. Debug has no entry, so graphile's
 * debug lines are dropped, as its default logger drops them: one of them
 * prints the pool options, connection string included.
 *
 * Only graphile's scope (worker, task and job ids) annotates a line. Its
 * per-line metadata holds the whole job row, whose payload can carry tokens.
 */
const graphileLevels: Record.ReadonlyRecord<string, (message: string) => Effect.Effect<void>> = {
  error: Effect.logError,
  warning: Effect.logWarning,
  info: Effect.logInfo,
};
