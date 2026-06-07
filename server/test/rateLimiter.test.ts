import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Redis from "ioredis";
import { Effect } from "effect";
import { loadEnvFile } from "node:process";

loadEnvFile();

type CheckRateLimit = typeof import("../services/rateLimiter.js").checkRateLimit;
type ClientIdentifierFromHeaders =
  typeof import("../services/rateLimiter.js").clientIdentifierFromHeaders;

let checkRateLimit: CheckRateLimit;
let clientIdentifierFromHeaders: ClientIdentifierFromHeaders;
let moduleValkey: Redis;

describe("rateLimiter", () => {
  beforeAll(async () => {
    vi.resetModules();

    const rateLimiter = await import("../services/rateLimiter.js");
    ({ checkRateLimit, clientIdentifierFromHeaders } = rateLimiter);
    moduleValkey = (await import("../valkey.js")).valkey;
    await moduleValkey.flushdb();
  });

  beforeEach(async () => {
    await moduleValkey.flushdb();
  });

  afterAll(async () => {
    await moduleValkey.quit();
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

  it("stores counters in valkey and expires them with the fixed window", async () => {
    const headers = { "x-real-ip": "203.0.113.7" };

    await Effect.runPromise(checkRateLimit("login", headers, 2, 50));
    await Effect.runPromise(checkRateLimit("login", headers, 2, 50));

    await expect(Effect.runPromise(checkRateLimit("login", headers, 2, 50))).rejects.toThrow(
      "Too many requests",
    );

    await new Promise((resolve) => setTimeout(resolve, 75));

    await expect(
      Effect.runPromise(checkRateLimit("login", headers, 2, 50)),
    ).resolves.toBeUndefined();
  });
});
