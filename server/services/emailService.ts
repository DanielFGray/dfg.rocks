import { Effect, Layer } from "effect";
import * as Redacted from "effect/Redacted";
import { Resend } from "resend";
import { env } from "../assertEnv.js";

type SendEmailParams = { to: string; subject: string; html: string };

interface EmailServiceShape {
  readonly send: (opts: SendEmailParams) => Effect.Effect<void, unknown>;
}

export class EmailService extends Effect.Tag("EmailService")<EmailService, EmailServiceShape>() {
  static readonly Live = Layer.effect(
    this,
    Effect.sync(() => {
      const apiKey = env.RESEND_API_KEY ? Redacted.value(env.RESEND_API_KEY).trim() : "";

      if (!apiKey) {
        throw new Error("RESEND_API_KEY is required by EmailService.Live");
      }

      const resend = new Resend(apiKey);

      return {
        send: (opts) =>
          Effect.tryPromise({
            try: () =>
              resend.emails
                .send({ from: "DFG Portal <noreply@dfg.rocks>", ...opts })
                .then(() => undefined),
            catch: (error) => error,
          }),
      } satisfies EmailServiceShape;
    }),
  );

  static readonly Test = Layer.succeed(this, {
    send: () => Effect.void,
  });
}
