import { Duration, Effect, Layer, Schedule, Schema as S } from "effect";
import { Redis } from "effect/persistence/Redis";

/** A service the server needs did not answer during startup. */
export class DependencyUnavailable extends S.TaggedError<
  DependencyUnavailable,
  { readonly brand: unique symbol }
>()("DependencyUnavailable", {
  dependency: S.String,
  cause: S.Defect(),
}) {
  override get message() {
    return `${this.dependency} did not answer`;
  }
}

/** Retries a dependency for about 78 seconds, then names it in the failure. */
export const waitFor =
  (dependency: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.tapError(() => Effect.logInfo(`Waiting for ${dependency}`)),
      Effect.retry(retrySchedule()),
      Effect.mapError((cause) => new DependencyUnavailable({ dependency, cause })),
    );

/** Makes the first production Valkey command before the server opens its port. */
export const ValkeyReady = Layer.effectDiscard(
  Redis.use((redis) => redis.send("PING")).pipe(
    waitFor("valkey"),
    Effect.andThen(Effect.log("Valkey is ready")),
    Effect.withSpan("server.waitForValkey"),
  ),
);

function retrySchedule() {
  return Schedule.max([
    Schedule.min([
      Schedule.exponential(Duration.millis(100)),
      Schedule.spaced(Duration.seconds(5)),
    ]),
    Schedule.recurs(20),
  ]);
}
