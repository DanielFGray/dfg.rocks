import { Config, Context, Effect, Layer, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { convert } from "html-to-text";
import lodash from "lodash";
import mjml from "mjml";

import packageJson from "../../package.json" with { type: "json" };
import { Mailer, MailMessage } from "./mailer.js";

const options = Schema.Struct({
  to: Schema.Union([Schema.NonEmptyString, Schema.NonEmptyArray(Schema.NonEmptyString)]),
  subject: Schema.String,
});

/** A `send_email` job: each template with the variables its enqueuer sends. */
export const QueuedEmail = Schema.Union([
  Schema.Struct({
    options,
    template: Schema.Literal("verify_email.mjml"),
    variables: Schema.Struct({ token: Schema.String, verifyLink: Schema.String }),
  }),
  Schema.Struct({
    options,
    template: Schema.Literal("password_reset.mjml"),
    variables: Schema.Struct({ token: Schema.String, resetLink: Schema.String }),
  }),
  Schema.Struct({
    options,
    template: Schema.Literal("password_reset_unregistered.mjml"),
    variables: Schema.Struct({ email: Schema.String }),
  }),
  Schema.Struct({
    options,
    template: Schema.Literal("magic_link.mjml"),
    variables: Schema.Struct({ token: Schema.String, loginLink: Schema.String }),
  }),
  Schema.Struct({
    options,
    template: Schema.Literal("delete_account.mjml"),
    variables: Schema.Struct({ token: Schema.String, deleteLink: Schema.String }),
  }),
  Schema.Struct({
    options,
    template: Schema.Literal("account_activity.mjml"),
    variables: Schema.Struct({
      userName: Schema.String,
      eventDescription: Schema.String,
      eventTime: Schema.String,
    }),
  }),
  Schema.Struct({
    options,
    template: Schema.Literal("invitation.mjml"),
    variables: Schema.Struct({ inviteLink: Schema.String }),
  }),
  Schema.Struct({
    options,
    template: Schema.Literal("testimonial_reminder.mjml"),
    variables: Schema.Struct({ displayName: Schema.String, testimonialLink: Schema.String }),
  }),
  Schema.Struct({
    options,
    template: Schema.Literal("contact_submission.mjml"),
    variables: Schema.Struct({
      name: Schema.String,
      email: Schema.String,
      phone: Schema.String,
      instrument: Schema.String,
      format: Schema.String,
      message: Schema.String,
    }),
  }),
]);
export type QueuedEmail = typeof QueuedEmail.Type;

export class EmailRenderError extends Schema.TaggedError<
  EmailRenderError,
  { readonly brand: unique symbol }
>()("EmailRenderError", {
  template: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * Decode one queued job, render its MJML template, and require delivery from
 * Mailer. A failure fails the job, so graphile-worker retries it. MJML
 * validation problems are logged and the message is still sent.
 */
export class EmailDelivery extends Context.Service<EmailDelivery>()("dfg-rocks/emailDelivery", {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = yield* Path;
    const mailer = yield* Mailer;
    const workerDirectory = yield* Config.NonEmptyString("WORKER_DIR").pipe(
      Config.withDefault("worker"),
    );
    const templateDirectory = path.join(workerDirectory, "templates");
    return {
      send: Effect.fn("EmailDelivery.send")(function* (job: QueuedEmail) {
        const source = yield* fs.readFileString(path.join(templateDirectory, job.template));
        const rendered = yield* Effect.tryPromise({
          try: () => {
            const render = lodash.template(source, { escape: /\[\[([\s\S]+?)\]\]/g });
            return mjml(
              render({
                projectName: packageJson.projectName,
                legalText: packageJson.legalText,
                ...job.variables,
              }),
            );
          },
          catch: (cause) => new EmailRenderError({ template: job.template, cause }),
        });
        if (rendered.errors.length > 0) {
          yield* Effect.logError(
            `MJML validation errors in ${job.template}`,
            rendered.errors.map((error) => error.formattedMessage),
          );
        }
        yield* mailer.send(
          new MailMessage({
            to: typeof job.options.to === "string" ? [job.options.to] : job.options.to,
            subject: job.options.subject,
            html: rendered.html,
            text: convert(rendered.html.replace(/(<\/?)div/g, "$1p"), { wordwrap: 120 }).replace(
              /\n\s+\n/g,
              "\n\n",
            ),
          }),
        );
      }),
    };
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
  static readonly layer = this.layerNoDeps.pipe(Layer.provide(Mailer.layer));
}
