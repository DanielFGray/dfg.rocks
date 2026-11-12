import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Ref } from "effect";
import { Redis, RedisError, make as makeRedis } from "effect/persistence/Redis";
import { TestClock } from "effect/testing";

import { DependencyUnavailable, ValkeyReady, waitFor } from "../dependencies.js";
import { checkRateLimit, RateLimit } from "../rateLimit.js";
import { RateLimiterMemory } from "../services/rateLimiter.js";

it.layer(RateLimit.layerCounted.pipe(Layer.provide(RateLimiterMemory)))((it) => {
  it.effect("allows the first rate-limited request after dependency readiness", () =>
    Effect.gen(function* () {
      yield* waitFor("valkey")(Effect.succeed("PONG"));
      yield* checkRateLimit("login", { "x-real-ip": "203.0.113.7" });
    }),
  );
});

it.effect("waits for Valkey when it starts after the process", () =>
  Effect.gen(function* () {
    const pings = yield* Ref.make(0);
    const result = yield* waitFor("valkey")(
      Effect.gen(function* () {
        const count = yield* Ref.updateAndGet(pings, (value) => value + 1);
        if (count <= 2) return yield* new RedisError({ cause: "connection refused" });
        return "PONG";
      }),
    ).pipe(Effect.forkChild);

    yield* TestClock.adjust("1 second");
    expect(yield* Fiber.join(result)).toBe("PONG");

    expect(yield* Ref.get(pings)).toBe(3);
  }),
);

it.effect("names Valkey when it never answers", () =>
  Effect.gen(function* () {
    const pings = yield* Ref.make(0);
    const wait = yield* Layer.build(ValkeyReady.pipe(Layer.provide(redisDown(pings)))).pipe(
      Effect.scoped,
      Effect.flip,
      Effect.forkChild,
    );

    yield* TestClock.adjust("5 minutes");
    const error = yield* Fiber.join(wait);

    expect(error).toBeInstanceOf(DependencyUnavailable);
    expect(error.dependency).toBe("valkey");
    expect(yield* Ref.get(pings)).toBe(21);
  }),
);

const redisDown = (pings: Ref.Ref<number>) =>
  Layer.effect(
    Redis,
    makeRedis({
      send: () =>
        Ref.update(pings, (count) => count + 1).pipe(
          Effect.andThen(Effect.fail(new RedisError({ cause: "connection refused" }))),
        ),
      subscribe: () => Effect.die("not used"),
      connect: Effect.die("not used"),
    }),
  );
