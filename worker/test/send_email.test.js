// @ts-check
import { beforeEach, describe, expect, mock, test } from "bun:test";

// nodemailer is replaced, so no test here opens a connection to Cloudflare.
const sendMail = mock();
const createTransport = mock(() => ({ sendMail }));
mock.module("nodemailer", () => {
  const nodemailer = { createTransport, getTestMessageUrl: () => false };
  return { ...nodemailer, default: nodemailer };
});

process.env.MAIL_PROVIDER = "cloudflare";
process.env.CLOUDFLARE_EMAIL_API_TOKEN = "test-token";
process.env.EMAIL_FROM = "DFG Music Lessons <noreply@example.test>";

const { mailProvider } = await import("../transport.js");
const { default: sendEmail } = await import("../tasks/send_email.js");

const contact = {
  options: { to: "admin@example.test", subject: "New contact" },
  template: "contact_submission.mjml",
  variables: {
    name: "<script>x</script>",
    email: "visitor@example.test",
    phone: "",
    instrument: "guitar",
    format: "in-person",
    message: "hello",
  },
};

describe("send_email with the cloudflare provider", () => {
  beforeEach(() => {
    sendMail.mockReset();
    sendMail.mockResolvedValue({ rejected: [], accepted: ["admin@example.test"] });
  });

  test("submits the rendered message over Cloudflare SMTP with the API token", async () => {
    await sendEmail(contact);

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.mx.cloudflare.net",
        port: 465,
        secure: true,
        auth: { user: "api_token", pass: "test-token" },
      }),
    );
    const [message] = sendMail.mock.calls[0] ?? [];
    expect(message).toMatchObject({
      from: "DFG Music Lessons <noreply@example.test>",
      to: "admin@example.test",
    });
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).not.toContain("<script>x");
  });

  test("fails the job, so graphile-worker retries, when the provider rejects a recipient", async () => {
    sendMail.mockResolvedValue({ rejected: ["admin@example.test"], accepted: [] });

    expect(sendEmail(contact)).rejects.toThrow(/rejected: admin@example.test/);
  });
});

describe("mail provider selection", () => {
  test("defaults to cloudflare in production, ethereal in development, JSON capture in tests", () => {
    expect(mailProvider({ NODE_ENV: "production" })).toBe("cloudflare");
    expect(mailProvider({ NODE_ENV: "development" })).toBe("development");
    expect(mailProvider({ NODE_ENV: "test" })).toBe("test");
  });

  test("rejects an unknown provider", () => {
    expect(() => mailProvider({ MAIL_PROVIDER: "ses" })).toThrow(/MAIL_PROVIDER must be one of/);
  });
});
