import { Effect } from "effect";
import * as Redacted from "effect/Redacted";
import { Resend } from "resend";
import { env } from "../assertEnv.js";

const resendApiKey = env.RESEND_API_KEY ? Redacted.value(env.RESEND_API_KEY).trim() : "";
const resend = resendApiKey ? new Resend(resendApiKey) : null;

type SendEmailParams = { to: string; subject: string; html: string };

const sendEffect = Effect.fnUntraced(function* (opts: SendEmailParams) {
  if (!resend) {
    console.log(`[email-stub] To: ${opts.to}, Subject: ${opts.subject}`);
    return;
  }

  yield* Effect.tryPromise({
    try: () =>
      resend.emails.send({ from: "DFG Portal <noreply@dfg.rocks>", ...opts }),
    catch: (error) => error,
  });
});

/**
 * Email delivery service. Static methods for direct Effect access;
 * class is a tag/layer for dependency injection.
 */
export class EmailService extends Effect.Service<EmailService>()(
  "EmailService",
  {
    succeed: { send: sendEffect },
  },
) {
  static readonly send = sendEffect;
}
