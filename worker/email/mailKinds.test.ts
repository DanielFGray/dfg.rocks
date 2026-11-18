import { EmailDelivery, MailCapture, Mailer } from "@danielfgray/stompbox/mail";
import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";

import {
  accountActivity,
  contactSubmission,
  deleteAccount,
  EmailDeliveryLive,
  familyInvitation,
  magicLink,
  passwordReset,
  passwordResetUnregistered,
  type QueuedEmail,
  testimonialReminder,
  verifyEmail,
} from "./mailKinds.js";

const options = { to: "player@example.invalid", subject: "Subject" };

/** One job per kind, with a value its template must print. */
const jobs: ReadonlyArray<readonly [job: QueuedEmail, expected: string]> = [
  [
    {
      options,
      template: verifyEmail.template,
      variables: { token: "t", verifyLink: "https://x.invalid/verify" },
    },
    "https://x.invalid/verify",
  ],
  [
    {
      options,
      template: passwordReset.template,
      variables: { token: "t", resetLink: "https://x.invalid/reset" },
    },
    "https://x.invalid/reset",
  ],
  [
    {
      options,
      template: passwordResetUnregistered.template,
      variables: { email: "nobody@example.invalid" },
    },
    "nobody@example.invalid",
  ],
  [
    {
      options,
      template: magicLink.template,
      variables: { token: "t", loginLink: "https://x.invalid/login" },
    },
    "https://x.invalid/login",
  ],
  [
    {
      options,
      template: deleteAccount.template,
      variables: { token: "t", deleteLink: "https://x.invalid/delete" },
    },
    "https://x.invalid/delete",
  ],
  [
    {
      options,
      template: accountActivity.template,
      variables: { userName: "Pat", eventDescription: "Password changed", eventTime: "Nov 10" },
    },
    "Password changed",
  ],
  [
    {
      options,
      template: familyInvitation.template,
      variables: { inviteLink: "https://x.invalid/invite" },
    },
    "https://x.invalid/invite",
  ],
  [
    {
      options,
      template: testimonialReminder.template,
      variables: { displayName: "Pat", testimonialLink: "https://x.invalid/dashboard" },
    },
    "https://x.invalid/dashboard",
  ],
  [
    {
      options,
      template: contactSubmission.template,
      variables: {
        name: "Visitor",
        email: "v@example.invalid",
        phone: "",
        instrument: "guitar",
        format: "in-person",
        message: "hello",
      },
    },
    "hello",
  ],
];

layer(
  EmailDeliveryLive.pipe(
    Layer.provideMerge(Mailer.layerCapture),
    Layer.provideMerge(MailCapture.layer),
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  ),
  { excludeTestServices: true },
)("the app's mail kinds", (it) => {
  it.effect("render through the app's templates with the variables its enqueuers send", () =>
    Effect.gen(function* () {
      const { send } = yield* EmailDelivery;
      yield* Effect.forEach(jobs, ([job]) => send(job));
      const delivered = yield* MailCapture.use((capture) => capture.sent);
      expect(delivered.map((mail) => mail.text)).toEqual(
        jobs.map(([, expected]) => expect.stringContaining(expected)),
      );
    }),
  );

  it.effect("escape variables in the HTML", () =>
    Effect.gen(function* () {
      const { send } = yield* EmailDelivery;
      yield* send({
        options,
        template: contactSubmission.template,
        variables: {
          name: "<script>x</script>",
          email: "v@example.invalid",
          phone: "",
          instrument: "guitar",
          format: "in-person",
          message: "hello",
        },
      });
      const delivered = yield* MailCapture.use((capture) => capture.sent);
      const html = delivered.at(-1)?.html ?? "";
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>x");
    }),
  );
});
