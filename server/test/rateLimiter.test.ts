import { it, expect, describe } from "@effect/vitest";
import { Effect, Exit, TestClock } from "effect";
import { loadEnvFile } from "node:process";
import {
  checkRateLimit,
  clientIdentifierFromHeaders,
  RateLimitError,
  RateLimiterLayer,
} from "../services/rateLimiter.js";

loadEnvFile();

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

  it.layer(RateLimiterLayer)((it) => {
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
});
