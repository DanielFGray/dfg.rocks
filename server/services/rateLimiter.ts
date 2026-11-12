import { Config, Duration, Layer } from "effect";
import {
  make,
  RateLimiter,
  type RateLimiterStore,
  layerStoreMemory,
  layerStoreRedisConfig,
} from "effect/persistence/RateLimiter";

/**
 * The `RateLimiter` that RateLimit (server/rateLimit.ts) counts against
 * in production. Counts live in Valkey, so a limit holds across restarts and
 * replicas.
 *
 * It requires Effect's `Redis` service (`effect/persistence/Redis`), which is
 * the Valkey client: server/runtime.ts provides it from `VALKEY_URL` with
 * `BunRedis`, since production runs on Bun. Valkey speaks the Redis protocol.
 *
 * Keys start with `VALKEY_KEY_PREFIX` and then `rl:`. The platform sets the
 * prefix to `<cartridge name>:`, the only keys the app's Valkey user may touch.
 */
export const RateLimiterValkey = rateLimiterWithStore(
  layerStoreRedisConfig({
    prefix: Config.String("VALKEY_KEY_PREFIX").pipe(Config.map((prefix) => `${prefix}rl:`)),
  }),
);

/** Counts in process memory, for tests that must run without a Valkey. */
export const RateLimiterMemory = rateLimiterWithStore(layerStoreMemory);

/**
 * The longest a caller waits for the store. The Valkey clients queue commands
 * while they reconnect, so without a deadline an outage would stall each
 * caller instead of letting it apply its own policy for a store that is down.
 */
export const storeTimeout = Duration.seconds(1);

/**
 * A `RateLimiter` over `store`. Each call makes a new Layer: a build memoizes
 * layers by reference, so two limiters made from Effect's one shared `layer`
 * would both get the store of whichever was built first.
 */
export function rateLimiterWithStore<E, R>(store: Layer.Layer<RateLimiterStore, E, R>) {
  return Layer.effect(RateLimiter, make).pipe(Layer.provide(store));
}
