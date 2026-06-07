import net from "node:net";
import { Effect, Duration, Layer } from "effect";
import { RateLimiter } from "@effect/experimental";
import { HttpError } from "../pgErrors.js";

export const RateLimiterLayer = RateLimiter.layer.pipe(
  Layer.provide(RateLimiter.layerStoreMemory),
);

export class RateLimitError extends HttpError {
  constructor() {
    super(429, "Too many requests");
  }
}

let disabled = false;

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

export function checkRateLimit(
  scope: string,
  headers: Record<string, string | undefined>,
  max: number,
  windowMs: number,
): Effect.Effect<void, RateLimitError | RateLimiter.RateLimiterError, RateLimiter.RateLimiter> {
  if (disabled) return Effect.void;

  const ip = clientIdentifierFromHeaders(headers);
  if (!ip) return Effect.void;

  return Effect.gen(function* () {
    const limiter = yield* RateLimiter.RateLimiter;

    yield* limiter
      .consume({
        key: `dfg:rl:${scope}:${ip}`,
        algorithm: "fixed-window",
        window: Duration.millis(windowMs),
        limit: max,
        onExceeded: "fail",
      })
      .pipe(
        Effect.mapError((error) =>
          error instanceof RateLimiter.RateLimitExceeded ? new RateLimitError() : error,
        ),
      );

    return undefined as void;
  });
}

/** Disable rate limiting (for tests). */
export function disableRateLimiting(): void {
  disabled = true;
}

export { RateLimiter };
