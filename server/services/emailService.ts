import { Effect } from "effect";
import { Resend } from "resend";
import { env } from "../assertEnv.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export class EmailService extends Effect.Service<EmailService>()(
  "EmailService",
  {
    effect: Effect.succeed({
      send: (opts: { to: string; subject: string; html: string }) =>
        Effect.gen(function* () {
          if (!resend) {
            console.log(
              `[email-stub] To: ${opts.to}, Subject: ${opts.subject}`,
            );
            return;
          }
          yield* Effect.tryPromise(() =>
            resend.emails.send({
              from: "DFG Portal <noreply@dfg.rocks>",
              ...opts,
            }),
          );
        }),
    }),
    accessors: true,
  },
) {}
