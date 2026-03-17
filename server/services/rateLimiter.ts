import { Context, Effect, Layer } from "effect";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export class RateLimiter extends Context.Tag("RateLimiter")<
  RateLimiter,
  {
    /** Check rate limit by key. Returns Effect that fails with RateLimitExceeded if over limit. */
    readonly check: (
      key: string,
      opts: { max: number; windowMs: number },
    ) => Effect.Effect<void, RateLimitExceeded>;
  }
>() {
  static Default = Layer.succeed(
    RateLimiter,
    RateLimiter.of({
      check: (key, { max, windowMs }) =>
        Effect.sync(() => {
          const now = Date.now();
          let entry = store.get(key);
          if (!entry || now > entry.resetAt) {
            entry = { count: 0, resetAt: now + windowMs };
            store.set(key, entry);
          }
          entry.count++;
          if (entry.count > max) {
            return Effect.fail(new RateLimitExceeded());
          }
          return Effect.void;
        }).pipe(Effect.flatten),
    }),
  );

  /** No-op rate limiter for testing — all checks pass */
  static Disabled = Layer.succeed(
    RateLimiter,
    RateLimiter.of({
      check: () => Effect.void,
    }),
  );
}

export class RateLimitExceeded {
  readonly _tag = "RateLimitExceeded" as const;
}

/** In-memory store. Entries auto-expire via resetAt check. Periodic cleanup every 60s. */
const store = new Map<string, RateLimitEntry>();
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 60_000);
