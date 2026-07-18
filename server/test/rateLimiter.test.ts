import { it, expect, describe } from "@effect/vitest";
import { Effect, Exit, TestClock } from "effect";
import {
  checkRateLimit,
  clientIdentifierFromHeaders,
  RateLimitError,
  RateLimitService,
} from "../services/rateLimiter.js";

describe("rateLimiter", () => {
  it("extracts the first client hop from trusted proxy headers", () => {
    expect(
      clientIdentifierFromHeaders({
        forwarded: "for=203.0.113.7;proto=https, for=10.0.0.9",
      }),
    ).toBe("203.0.113.7");

    expect(
      clientIdentifierFromHeaders({
        "x-real-ip": "198.51.100.8",
        "x-forwarded-for": "203.0.113.7, 10.0.0.9",
      }),
    ).toBe("198.51.100.8");
  });

  it.layer(RateLimitService.Live)((it) => {
    it.effect("stores counters in memory and expires them with the fixed window", () =>
      Effect.gen(function* () {
        const headers = { "x-real-ip": "203.0.113.7" };

        yield* checkRateLimit("login", headers, 2, 50);
        yield* checkRateLimit("login", headers, 2, 50);

        const exceeded = yield* Effect.exit(checkRateLimit("login", headers, 2, 50));
        expect(exceeded).toStrictEqual(Exit.fail(new RateLimitError()));

        yield* TestClock.adjust("75 millis");

        yield* checkRateLimit("login", headers, 2, 50);
      }),
    );
  });

  it.layer(RateLimitService.Test)((it) => {
    it.effect("allows requests without allocating shared limiter state", () =>
      Effect.gen(function* () {
        const headers = { "x-real-ip": "203.0.113.7" };

        for (let request = 0; request < 10; request++) {
          yield* checkRateLimit("login", headers, 1, 60000);
        }
      }),
    );
  });
});
