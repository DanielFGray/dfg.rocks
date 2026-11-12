import { WorkerTasks } from "../workerTasks.js";
import { CalendarSync } from "../calendar/calendarSync.js";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import { Context, ConfigProvider, Effect, Layer } from "effect";
import { MailCapture, Mailer, mailProvider } from "./mailer.js";
import { EmailDelivery } from "./emailDelivery.js";

// nodemailer is replaced, so no test here opens a connection to Cloudflare.
const smtp = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock("nodemailer", () => ({
  createTransport: smtp.createTransport.mockImplementation(() => ({
    sendMail: smtp.sendMail,
    close: () => undefined,
  })),
  createTestAccount: vi.fn(),
  getTestMessageUrl: () => false,
}));

const to = { to: "player@example.invalid", subject: "Subject" };

/** One job per template, with the variables its enqueuer sends, and text the message must hold. */
const jobs = [
  [
    {
      template: "verify_email.mjml",
      variables: { token: "t", verifyLink: "https://x.invalid/verify" },
    },
    "https://x.invalid/verify",
  ],
  [
    {
      template: "password_reset.mjml",
      variables: { token: "t", resetLink: "https://x.invalid/reset" },
    },
    "https://x.invalid/reset",
  ],
  [
    {
      template: "password_reset_unregistered.mjml",
      variables: { email: "nobody@example.invalid" },
    },
    "nobody@example.invalid",
  ],
  [
    {
      template: "magic_link.mjml",
      variables: { token: "t", loginLink: "https://x.invalid/login" },
    },
    "https://x.invalid/login",
  ],
  [
    {
      template: "delete_account.mjml",
      variables: { token: "t", deleteLink: "https://x.invalid/delete" },
    },
    "https://x.invalid/delete",
  ],
  [
    {
      template: "account_activity.mjml",
      variables: {
        userName: "Pat",
        eventDescription: "Password changed",
        eventTime: "Nov 10, 2026",
      },
    },
    "Password changed",
  ],
  [
    { template: "invitation.mjml", variables: { inviteLink: "https://x.invalid/invite" } },
    "https://x.invalid/invite",
  ],
  [
    {
      template: "testimonial_reminder.mjml",
      variables: { displayName: "Pat", testimonialLink: "https://x.invalid/dashboard" },
    },
    "https://x.invalid/dashboard",
  ],
  [
    {
      template: "contact_submission.mjml",
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
] as const;

const contact = { options: to, ...jobs[8][0] };

const withConfig = (env: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(env));

describe("queued email delivery", () => {
  it.live("renders every template with the variables its enqueuer sends", () =>
    Effect.gen(function* () {
      const capture = yield* Layer.build(MailCapture.layer);
      const mailCapture = Context.get(capture, MailCapture);
      const delivery = yield* EmailDelivery.make.pipe(
        Effect.provideService(Mailer, { send: mailCapture.record }),
        Effect.provide(NodeServices.layer),
      );
      yield* Effect.forEach(jobs, ([job]) => delivery.send({ options: to, ...job })).pipe(
        Effect.provide(NodeServices.layer),
      );
      const delivered = yield* mailCapture.sent;
      expect(delivered.map((mail) => mail.to)).toEqual(jobs.map(() => ["player@example.invalid"]));
      jobs.forEach(([, expected], index) => {
        expect(delivered[index]?.text).toContain(expected);
      });
    }),
  );

  it.live("escapes variables in the HTML", () =>
    Effect.gen(function* () {
      const mailCapture = yield* MailCapture.make;
      const delivery = yield* EmailDelivery.make.pipe(
        Effect.provideService(Mailer, { send: mailCapture.record }),
        Effect.provide(NodeServices.layer),
      );
      yield* delivery
        .send({
          ...contact,
          variables: { ...contact.variables, name: "<script>x</script>" },
        })
        .pipe(Effect.provide(NodeServices.layer));
      const [mail] = yield* mailCapture.sent;
      expect(mail?.html).toContain("&lt;script&gt;");
      expect(mail?.html).not.toContain("<script>x");
    }),
  );

  it.live("rejects a payload that does not match its template before delivery", () =>
    Effect.gen(function* () {
      const mailCapture = yield* MailCapture.make;
      const delivery = yield* EmailDelivery.make.pipe(
        Effect.provideService(Mailer, { send: mailCapture.record }),
        Effect.provide(NodeServices.layer),
      );
      const jobs = yield* WorkerTasks.make.pipe(
        Effect.provideService(EmailDelivery, delivery),
        Effect.provideService(CalendarSync, { sync: () => Effect.void }),
      );
      const error = yield* jobs
        .send_email({ ...contact, variables: { name: "Visitor" } })
        .pipe(Effect.flip);
      expect(error._tag).toBe("SchemaError");
      expect(yield* mailCapture.sent).toHaveLength(0);
    }),
  );
});

describe("the cloudflare provider", () => {
  const cloudflare = Layer.mergeAll(
    EmailDelivery.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          withConfig({
            MAIL_PROVIDER: "cloudflare",
            CLOUDFLARE_EMAIL_API_TOKEN: "test-token",
            EMAIL_FROM: "DFG Music Lessons <noreply@example.invalid>",
          }),
          NodeServices.layer,
        ),
      ),
    ),
    NodeServices.layer,
  );

  it.live("submits the message over Cloudflare SMTP with the API token", () =>
    Effect.gen(function* () {
      smtp.sendMail.mockResolvedValue({ rejected: [], accepted: ["admin@example.invalid"] });
      yield* EmailDelivery.use((delivery) => delivery.send(contact)).pipe(
        Effect.provide(cloudflare),
      );

      expect(smtp.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "smtp.mx.cloudflare.net",
          port: 465,
          secure: true,
          auth: { user: "api_token", pass: "test-token" },
        }),
      );
      expect(smtp.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "DFG Music Lessons <noreply@example.invalid>",
          to: ["player@example.invalid"],
        }),
      );
    }),
  );

  it.live("fails the job, so graphile-worker retries, when the provider rejects a recipient", () =>
    Effect.gen(function* () {
      smtp.sendMail.mockResolvedValue({ rejected: ["player@example.invalid"], accepted: [] });
      const error = yield* EmailDelivery.use((delivery) => delivery.send(contact)).pipe(
        Effect.provide(cloudflare),
        Effect.flip,
      );
      expect(error._tag).toBe("MailDeliveryError");
    }),
  );
});

describe("mail provider selection", () => {
  it.live("defaults by NODE_ENV when MAIL_PROVIDER is unset", () =>
    Effect.gen(function* () {
      const provider = (env: Record<string, string>) =>
        mailProvider.pipe(Effect.provide(withConfig(env)));
      expect(yield* provider({ NODE_ENV: "development" })).toBe("ethereal");
      expect(yield* provider({ NODE_ENV: "test" })).toBe("capture");
      expect(yield* provider({ NODE_ENV: "production" })).toBe("cloudflare");
      expect(yield* provider({ NODE_ENV: "production", MAIL_PROVIDER: "ethereal" })).toBe(
        "ethereal",
      );
    }),
  );

  it.live("rejects an unknown provider", () =>
    Effect.gen(function* () {
      const error = yield* mailProvider.pipe(
        Effect.provide(withConfig({ MAIL_PROVIDER: "ses" })),
        Effect.flip,
      );
      expect(error._tag).toBe("ConfigError");
    }),
  );
});
