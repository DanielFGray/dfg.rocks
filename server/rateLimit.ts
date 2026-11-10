import net from "node:net";
import { Context, Duration, Effect, Layer, Match } from "effect";
import { RateLimiter } from "effect/persistence/RateLimiter";
import { HttpError } from "./pgErrors.js";
import { storeTimeout } from "./services/rateLimiter.js";

/**
 * Per-address limits on the endpoints that send email, check a secret or cost
 * a password hash. A handler is limited only where it calls `checkRateLimit`.
 */
interface Rule {
  readonly limit: number;
  readonly window: Duration.Input;
  /**
   * What to do when the store cannot answer. Deny where the endpoint sends
   * email, since an open gate there is the abuse. Allow on login and the other
   * secret checks, so an outage does not lock everyone out.
   */
  readonly whenStoreDown: "allow" | "deny";
}

const rules = {
  login: { limit: 10, window: "1 minute", whenStoreDown: "allow" },
  "magic-link": { limit: 5, window: "1 minute", whenStoreDown: "deny" },
  "forgot-password": { limit: 5, window: "1 hour", whenStoreDown: "deny" },
  "reset-password": { limit: 10, window: "1 hour", whenStoreDown: "allow" },
  contact: { limit: 5, window: "1 minute", whenStoreDown: "deny" },
  "accept-invite": { limit: 10, window: "1 minute", whenStoreDown: "allow" },
} satisfies Record<string, Rule>;

export type RateLimitRule = keyof typeof rules;

export class RateLimitError extends HttpError {
  constructor() {
    super(429, "Too many requests");
  }
}

export class RateLimitService extends Context.Service<
  RateLimitService,
  {
    readonly check: (
      rule: RateLimitRule,
      headers: Record<string, string | undefined>,
    ) => Effect.Effect<void, RateLimitError>;
  }
>()("RateLimitService") {
  /** Counts against the `RateLimiter` in context: `RateLimiterValkey` in production. */
  static readonly Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const limiter = yield* RateLimiter;
      return {
        check: (name, headers) => {
          const rule: Rule = rules[name];
          // Requests without a proxy-set address share one bucket, so they are limited rather than exempt.
          const caller = clientIdentifierFromHeaders(headers) ?? "unknown";
          return limiter
            .consume({
              key: `${name}:${caller}`,
              algorithm: "fixed-window",
              window: rule.window,
              limit: rule.limit,
              onExceeded: "fail",
            })
            .pipe(
              Effect.timeout(storeTimeout),
              Effect.catchTags({
                RateLimiterError: (error) =>
                  Match.value(error.reason).pipe(
                    Match.tag("RateLimitExceeded", () => Effect.fail(new RateLimitError())),
                    Match.tag("RateLimitStoreError", (failure) => storeDown(rule, failure.message)),
                    Match.exhaustive,
                  ),
                TimeoutError: () => storeDown(rule, "timed out"),
              }),
              Effect.asVoid,
            );
        },
      };
    }),
  );

  static readonly Test = Layer.succeed(this, { check: () => Effect.void });
}

export const checkRateLimit = (rule: RateLimitRule, headers: Record<string, string | undefined>) =>
  RateLimitService.use((rateLimit) => rateLimit.check(rule, headers));

// The ingress proxy (Traefik) discards any client-sent X-Real-Ip and sets it from the connection.
// Every other client-IP header passes through it unchanged, so a client could forge it.
export function clientIdentifierFromHeaders(
  headers: Record<string, string | undefined>,
): string | undefined {
  const candidate = headers["x-real-ip"]?.trim();
  return candidate && net.isIP(candidate) ? candidate : undefined;
}

const storeDown = (rule: Rule, reason: string) =>
  Effect.logWarning("Rate limiter store unavailable", reason).pipe(
    Effect.andThen(
      rule.whenStoreDown === "allow" ? Effect.void : Effect.fail(new RateLimitError()),
    ),
  );
