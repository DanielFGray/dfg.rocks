import net from "node:net";
import { RateLimiter as ExperimentalRateLimiter } from "@effect/experimental";
import { Context, Duration, Effect, Layer } from "effect";
import { HttpError } from "../pgErrors.js";

export class RateLimitError extends HttpError {
  constructor() {
    super(429, "Too many requests");
  }
}

interface RateLimitServiceShape {
  readonly consume: (
    key: string,
    max: number,
    windowMs: number,
  ) => Effect.Effect<void, RateLimitError | ExperimentalRateLimiter.RateLimitStoreError>;
}

export class RateLimitService extends Context.Tag("RateLimitService")<
  RateLimitService,
  RateLimitServiceShape
>() {
  static readonly Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const limiter = yield* ExperimentalRateLimiter.RateLimiter;

      return {
        consume: (key, max, windowMs) =>
          limiter
            .consume({
              key,
              algorithm: "fixed-window",
              window: Duration.millis(windowMs),
              limit: max,
              onExceeded: "fail",
            })
            .pipe(
              Effect.mapError((error) =>
                error instanceof ExperimentalRateLimiter.RateLimitExceeded
                  ? new RateLimitError()
                  : error,
              ),
              Effect.asVoid,
            ),
      } satisfies RateLimitServiceShape;
    }),
  ).pipe(
    Layer.provide(
      ExperimentalRateLimiter.layer.pipe(Layer.provide(ExperimentalRateLimiter.layerStoreMemory)),
    ),
  );

  static readonly Test = Layer.succeed(this, {
    consume: () => Effect.void,
  });
}

// The ingress proxy (Traefik) discards any client-sent X-Real-Ip and sets it from the connection.
// Every other client-IP header passes through it unchanged, so a client could forge it.
export function clientIdentifierFromHeaders(
  headers: Record<string, string | undefined>,
): string | undefined {
  const candidate = headers["x-real-ip"]?.trim();
  return candidate && net.isIP(candidate) ? candidate : undefined;
}

export const checkRateLimit = Effect.fnUntraced(function* (
  scope: string,
  headers: Record<string, string | undefined>,
  max: number,
  windowMs: number,
) {
  // Requests without a proxy-set address share one bucket, so they are limited rather than exempt.
  const ip = clientIdentifierFromHeaders(headers) ?? "unknown";

  const rateLimiter = yield* RateLimitService;
  yield* rateLimiter.consume(`dfg:rl:${scope}:${ip}`, max, windowMs);

  return yield* Effect.void;
});
