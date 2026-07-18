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

function normalizeIpCandidate(candidate?: string): string | undefined {
  if (!candidate) {
    return undefined;
  }

  let value = candidate.trim();
  if (!value || value.toLowerCase() === "unknown") {
    return undefined;
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }

  if (value.startsWith("[")) {
    const endBracket = value.indexOf("]");
    if (endBracket > 0) {
      value = value.slice(1, endBracket);
    }
  } else if (value.includes(":") && value.indexOf(":") === value.lastIndexOf(":")) {
    const host = value.slice(0, value.lastIndexOf(":"));
    if (net.isIP(host)) {
      value = host;
    }
  }

  return net.isIP(value) ? value : undefined;
}

function forwardedClientIdentifier(header?: string): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const entry of header.split(",")) {
    for (const part of entry.split(";")) {
      const trimmed = part.trim();
      if (!trimmed.toLowerCase().startsWith("for=")) {
        continue;
      }

      return normalizeIpCandidate(trimmed.slice(4));
    }
  }

  return undefined;
}

export function clientIdentifierFromHeaders(
  headers: Record<string, string | undefined>,
): string | undefined {
  return (
    forwardedClientIdentifier(headers.forwarded) ??
    normalizeIpCandidate(headers["x-real-ip"]) ??
    normalizeIpCandidate(headers["cf-connecting-ip"]) ??
    normalizeIpCandidate(headers["true-client-ip"]) ??
    normalizeIpCandidate(headers["fly-client-ip"]) ??
    normalizeIpCandidate(headers["x-forwarded-for"]?.split(",")[0])
  );
}

export const checkRateLimit = Effect.fnUntraced(function* (
  scope: string,
  headers: Record<string, string | undefined>,
  max: number,
  windowMs: number,
) {
  const ip = clientIdentifierFromHeaders(headers);
  if (!ip) return yield* Effect.void;

  const rateLimiter = yield* RateLimitService;
  yield* rateLimiter.consume(`dfg:rl:${scope}:${ip}`, max, windowMs);

  return yield* Effect.void;
});
