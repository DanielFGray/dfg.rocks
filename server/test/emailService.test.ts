import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect, vi } from "vitest";

const resendMock = vi.hoisted(() => ({
  construct: vi.fn(),
  send: vi.fn(() => Promise.resolve({ data: { id: "email-id" }, error: null })),
}));

vi.mock("../assertEnv.js", async () => {
  const Redacted = await import("effect/Redacted");
  return { env: { RESEND_API_KEY: Redacted.make("test-api-key") } };
});

vi.mock("resend", () => ({
  Resend: class {
    readonly emails = { send: resendMock.send };

    constructor(apiKey: string) {
      resendMock.construct(apiKey);
    }
  },
}));

import { EmailService } from "../services/emailService.js";

describe("EmailService", () => {
  it.effect("provides a deterministic Test implementation", () =>
    Effect.gen(function* () {
      yield* EmailService.send({
        to: "recipient@example.com",
        subject: "Test subject",
        html: "<p>Test body</p>",
      });

      expect(resendMock.construct).not.toHaveBeenCalled();
      expect(resendMock.send).not.toHaveBeenCalled();
    }).pipe(Effect.provide(EmailService.Test)),
  );

  it.effect("constructs Resend during Live acquisition and delegates send", () => {
    expect(resendMock.construct).not.toHaveBeenCalled();

    return Effect.gen(function* () {
      yield* EmailService.send({
        to: "recipient@example.com",
        subject: "Live subject",
        html: "<p>Live body</p>",
      });

      expect(resendMock.construct).toHaveBeenCalledOnce();
      expect(resendMock.construct).toHaveBeenCalledWith("test-api-key");
      expect(resendMock.send).toHaveBeenCalledWith({
        from: "DFG Portal <noreply@dfg.rocks>",
        to: "recipient@example.com",
        subject: "Live subject",
        html: "<p>Live body</p>",
      });
    }).pipe(Effect.provide(EmailService.Live));
  });
});
