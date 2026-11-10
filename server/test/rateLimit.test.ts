import { it, expect, describe } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer } from "effect";
import {
  RateLimiterError,
  RateLimiterStore,
  RateLimitStoreError,
} from "effect/persistence/RateLimiter";
import { TestClock } from "effect/testing";
import {
  checkRateLimit,
  clientIdentifierFromHeaders,
  RateLimitError,
  RateLimitService,
} from "../rateLimit.js";
import { RateLimiterMemory, rateLimiterWithStore, storeTimeout } from "../services/rateLimiter.js";

const headers = { "x-real-ip": "203.0.113.7" };

describe("rateLimit", () => {
  it("identifies the client only by the proxy-set X-Real-Ip", () => {
    expect(
      clientIdentifierFromHeaders({
        "x-real-ip": "198.51.100.8",
        forwarded: "for=203.0.113.7",
        "x-forwarded-for": "203.0.113.7, 10.0.0.9",
        "cf-connecting-ip": "203.0.113.7",
      }),
    ).toBe("198.51.100.8");

    expect(
      clientIdentifierFromHeaders({
        forwarded: "for=203.0.113.7",
        "x-forwarded-for": "203.0.113.7",
      }),
    ).toBeUndefined();
  });

  it.layer(RateLimitService.Live.pipe(Layer.provide(RateLimiterMemory)))((it) => {
    it.effect("counts each rule per address and resets with the rule's window", () =>
      Effect.gen(function* () {
        for (let request = 0; request < 10; request++) {
          yield* checkRateLimit("login", headers);
        }

        const exceeded = yield* Effect.exit(checkRateLimit("login", headers));
        expect(exceeded).toStrictEqual(Exit.fail(new RateLimitError()));
        yield* checkRateLimit("login", { "x-real-ip": "198.51.100.8" });
        yield* checkRateLimit("reset-password", headers);

        yield* TestClock.adjust("1 minute");

        yield* checkRateLimit("login", headers);
      }),
    );

    it.effect("limits requests that carry no proxy-set address", () =>
      Effect.gen(function* () {
        for (let request = 0; request < 5; request++) {
          yield* checkRateLimit("magic-link", {});
        }

        const exceeded = yield* Effect.exit(checkRateLimit("magic-link", {}));
        expect(exceeded).toStrictEqual(Exit.fail(new RateLimitError()));
      }),
    );
  });

  // Valkey refuses a command, or the client queues commands while it reconnects and never answers.
  describe.each([
    ["fails", Effect.fail(storeFailure())],
    ["does not answer", Effect.never],
  ])("when the store %s", (_, answer) => {
    it.layer(RateLimitService.Live.pipe(Layer.provide(storeAnswering(answer))))((it) => {
      it.effect("allows a rule that allows when the store is down", () =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(checkRateLimit("login", headers));
          yield* TestClock.adjust(storeTimeout);

          expect(yield* Fiber.await(fiber)).toStrictEqual(Exit.void);
        }),
      );

      it.effect("refuses a rule that denies when the store is down", () =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(checkRateLimit("forgot-password", headers));
          yield* TestClock.adjust(storeTimeout);

          expect(yield* Fiber.await(fiber)).toStrictEqual(Exit.fail(new RateLimitError()));
        }),
      );
    });
  });

  it.layer(RateLimitService.Test)((it) => {
    it.effect("allows every request outside production", () =>
      Effect.gen(function* () {
        for (let request = 0; request < 20; request++) {
          yield* checkRateLimit("login", headers);
        }
      }),
    );
  });
});

function storeFailure() {
  return new RateLimiterError({ reason: new RateLimitStoreError({ message: "Valkey is down" }) });
}

function storeAnswering(answer: Effect.Effect<never, RateLimiterError>) {
  return rateLimiterWithStore(
    Layer.succeed(
      RateLimiterStore,
      RateLimiterStore.of({
        fixedWindow: () => answer,
        tokenBucket: () => answer,
        adaptiveConsume: () => answer,
        adaptiveFeedback: () => answer,
      }),
    ),
  );
}
