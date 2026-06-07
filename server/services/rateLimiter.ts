import net from "node:net";
import { Effect } from "effect";
import { HttpError } from "../pgErrors.js";
import { valkey } from "../valkey.js";

const RATE_LIMIT_KEY_PREFIX = "dfg:rl";
const WINDOW_COUNTER_LUA = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return count
`;

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

function rateLimitKey(
  scope: string,
  headers: Record<string, string | undefined>,
): string | undefined {
  const clientId = clientIdentifierFromHeaders(headers);
  if (!clientId) {
    return undefined;
  }

  return `${RATE_LIMIT_KEY_PREFIX}:${scope}:${clientId}`;
}

export function checkRateLimit(
  scope: string,
  headers: Record<string, string | undefined>,
  max: number,
  windowMs: number,
): Effect.Effect<void, unknown, never> {
  if (disabled) {
    return Effect.void;
  }

  const key = rateLimitKey(scope, headers);
  if (!key) {
    return Effect.void;
  }

  return Effect.tryPromise({
    try: () => valkey.eval(WINDOW_COUNTER_LUA, 1, key, String(windowMs)),
    catch: (error) => error,
  }).pipe(
    Effect.flatMap((count) =>
      Number(count) > max ? Effect.fail(new RateLimitError()) : Effect.void,
    ),
  );
}

/** Disable rate limiting (for tests). */
export function disableRateLimiting(): void {
  disabled = true;
}
