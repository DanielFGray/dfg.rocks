// @entrypoint: graphile-worker calls the tasks, which run with the worker's context.
import { EmailDelivery, Mailer } from "@danielfgray/stompbox/mail";
import { effectTask, runWorker } from "@danielfgray/stompbox/worker";
import { Config, Context, Effect, Layer, Path, Schema } from "effect";

import packageJson from "../package.json" with { type: "json" };
import {
  AccountMail,
  AuditEvent,
  DeleteAccount,
  ForgotPassword,
  ForgotPasswordUnregistered,
  MagicLink,
  SendVerification,
} from "./accountMail.js";
import { EmailDeliveryLive, QueuedEmail } from "./email/mailKinds.js";
import { WorkerDirectory } from "./config.js";
import { CalendarSync, CalendarSyncJob } from "./calendar/calendarSync.js";
import { BillingLedger } from "../server/services/billingLedger.js";
import { RecurringSchedule, PrepaidPeriod } from "../server/services/recurringSchedule.js";
import { Families, SendInvitation } from "../server/services/families.js";
import { TestimonialReminder } from "../server/services/testimonialReminder.js";
import { PgRootDB } from "../server/db.js";

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
    const task = effectTask(context);
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
        EmailDeliveryLive,
        CalendarSync.layer,
        BillingLedger.layer,
        RecurringSchedule.layer,
        Families.layer,
        TestimonialReminder.layer,
        PgRootDB.layer,
      ),
    ),
    Layer.provide(Mailer.layerConfig({ defaultFrom: packageJson.fromEmail })),
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
    const connectionString = yield* Config.Redacted("DATABASE_URL");
    const path = yield* Path.Path;
    const workerDirectory = yield* WorkerDirectory;
    const taskList = yield* WorkerJobs;
    return yield* runWorker({
      connectionString,
      taskList,
      crontabFile: path.join(workerDirectory, "crontab"),
    });
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(WorkerJobs.layer));
}
