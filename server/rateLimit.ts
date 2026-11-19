import net from "node:net";
import { Config, Context, Duration, Effect, Layer, Match } from "effect";
import { RateLimiter } from "effect/persistence/RateLimiter";
import { HttpError } from "./pgErrors.js";
import { RateLimiterValkey, storeTimeout } from "./services/rateLimiter.js";

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
  // Each checkout call creates a Stripe session, and each portal call opens one. An outage of the
  // store must not open either gate.
  checkout: { limit: 10, window: "1 minute", whenStoreDown: "deny" },
  "billing-portal": { limit: 10, window: "1 minute", whenStoreDown: "deny" },
  "accept-invite": { limit: 10, window: "1 minute", whenStoreDown: "allow" },
} satisfies Record<string, Rule>;

export type RateLimitRule = keyof typeof rules;

export class RateLimitError extends HttpError {
  static new() {
    return new RateLimitError({ status: 429, message: "Too many requests" });
  }
}
const countedRateLimit = Effect.gen(function* () {
  const limiter = yield* RateLimiter;
  return {
    check: (name: RateLimitRule, headers: Record<string, string | undefined>) => {
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
                Match.tag("RateLimitExceeded", () => Effect.fail(RateLimitError.new())),
                Match.tag("RateLimitStoreError", (failure) => storeDown(rule, failure.message)),
                Match.exhaustive,
              ),
            TimeoutError: () => storeDown(rule, "timed out"),
          }),
          Effect.asVoid,
        );
    },
  };
});
export class RateLimit extends Context.Service<RateLimit>()("dfg-rocks/rateLimit", {
  make: Effect.gen(function* () {
    if ((yield* Config.String("NODE_ENV")) !== "production")
      return {
        check: (_rule: RateLimitRule, _headers: Record<string, string | undefined>) => Effect.void,
      };
    return yield* countedRateLimit;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(RateLimiterValkey));
  static readonly layerCounted = Layer.effect(this, countedRateLimit);
  static readonly layerTest = Layer.succeed(this, {
    check: (_rule: RateLimitRule, _headers: Record<string, string | undefined>) => Effect.void,
  });
}

export const checkRateLimit = (rule: RateLimitRule, headers: Record<string, string | undefined>) =>
  RateLimit.use((rateLimit) => rateLimit.check(rule, headers));

/**
 * The header that holds the client address. The ingress proxy (Traefik) discards any client-sent
 * X-Real-Ip and sets it from the connection. Every other client-IP header passes through it
 * unchanged, so a client could forge it.
 */
export const clientAddressHeader = "x-real-ip";

export function clientIdentifierFromHeaders(
  headers: Record<string, string | undefined>,
): string | undefined {
  const candidate = headers[clientAddressHeader]?.trim();
  return candidate && net.isIP(candidate) ? candidate : undefined;
}

const storeDown = (rule: Rule, reason: string) =>
  Effect.logWarning("Rate limiter store unavailable", reason).pipe(
    Effect.andThen(
      rule.whenStoreDown === "allow" ? Effect.void : Effect.fail(RateLimitError.new()),
    ),
  );
