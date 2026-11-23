import { EmailDelivery, mailKind, queuedEmail } from "@danielfgray/stompbox/mail";
import { Effect, Layer, Path, Schema } from "effect";

import packageJson from "../../package.json" with { type: "json" };
import { WorkerDirectory } from "../config.js";

/**
 * The app's mail kinds: each names an MJML file in `worker/templates/` and the
 * variables that file reads. The services queue them as `send_email` jobs.
 */
export const verifyEmail = mailKind("verify_email.mjml", {
  token: Schema.String,
  verifyLink: Schema.String,
});

export const passwordReset = mailKind("password_reset.mjml", {
  token: Schema.String,
  resetLink: Schema.String,
});

export const passwordResetUnregistered = mailKind("password_reset_unregistered.mjml", {
  email: Schema.String,
});

export const magicLink = mailKind("magic_link.mjml", {
  token: Schema.String,
  loginLink: Schema.String,
});

export const deleteAccount = mailKind("delete_account.mjml", {
  token: Schema.String,
  deleteLink: Schema.String,
});

/** A security notice: exempt from the per-address cap. */
export const accountActivity = mailKind(
  "account_activity.mjml",
  { userName: Schema.String, eventDescription: Schema.String, eventTime: Schema.String },
  { notice: true },
);

export const familyInvitation = mailKind("invitation.mjml", { inviteLink: Schema.String });

/** An account staff created: the link logs its owner in. Empty strings mean "not given". */
export const accountInvitation = mailKind("account_invitation.mjml", {
  inviteeName: Schema.String,
  inviterName: Schema.String,
  message: Schema.String,
  loginLink: Schema.String,
});

export const testimonialReminder = mailKind("testimonial_reminder.mjml", {
  displayName: Schema.String,
  testimonialLink: Schema.String,
});

export const contactSubmission = mailKind("contact_submission.mjml", {
  name: Schema.String,
  email: Schema.String,
  phone: Schema.String,
  instrument: Schema.String,
  format: Schema.String,
  message: Schema.String,
});

const kinds = [
  verifyEmail,
  passwordReset,
  passwordResetUnregistered,
  magicLink,
  deleteAccount,
  accountActivity,
  familyInvitation,
  accountInvitation,
  testimonialReminder,
  contactSubmission,
];

/** The payload of a `send_email` job. */
export const QueuedEmail = queuedEmail(kinds);
export type QueuedEmail = typeof QueuedEmail.Type;

/**
 * Renders the kinds above. Templates come from `WORKER_DIR`, relative to the
 * working directory: the production server is one bundle, so a path relative to
 * this module would point into it.
 */
export const EmailDeliveryLive = Layer.unwrap(
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const workerDirectory = yield* WorkerDirectory;
    return EmailDelivery.layer({
      kinds,
      // The app's layer graph has no RateLimiter service yet, only RateLimit.
      cap: false,
      templates: path.join(workerDirectory, "templates"),
      brand: { projectName: packageJson.projectName, legalText: packageJson.legalText },
    });
  }),
);
