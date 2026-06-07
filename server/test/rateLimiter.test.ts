import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";
import { RateLimiter } from "@effect/experimental";
import { loadEnvFile } from "node:process";

loadEnvFile();

type CheckRateLimit = typeof import("../services/rateLimiter.js").checkRateLimit;
type ClientIdentifierFromHeaders =
  typeof import("../services/rateLimiter.js").clientIdentifierFromHeaders;

let checkRateLimit: CheckRateLimit;
let clientIdentifierFromHeaders: ClientIdentifierFromHeaders;

describe("rateLimiter", () => {
  beforeEach(async () => {
    vi.resetModules();

    const rateLimiter = await import("../services/rateLimiter.js");
    ({ checkRateLimit, clientIdentifierFromHeaders } = rateLimiter);
  });

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

  it("stores counters in memory and expires them with the fixed window", async () => {
    // Fresh in-memory store per test
    const rateLimiterLayer = RateLimiter.layer.pipe(
      Layer.provide(RateLimiter.layerStoreMemory),
    );

    const run = (scope: string, headers: Record<string, string | undefined>, max: number, windowMs: number) =>
      Effect.runPromise(
        checkRateLimit(scope, headers, max, windowMs).pipe(
          Effect.provide(rateLimiterLayer),
        ),
      );

    const headers = { "x-real-ip": "203.0.113.7" };

    await run("login", headers, 2, 50);
    await run("login", headers, 2, 50);

    await expect(run("login", headers, 2, 50)).rejects.toThrow("Too many requests");

    await new Promise((resolve) => setTimeout(resolve, 75));

    await expect(run("login", headers, 2, 50)).resolves.toBeUndefined();
  });
});
