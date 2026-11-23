import { Context, Effect, Layer, Schema as S } from "effect";
import { renderScoreSvg } from "gigbag.js/render";
import { Storage, type StorageLocation } from "./storage.js";

/**
 * The width static scores are laid out at. The static score scales to its container; the
 * player lays the score out again at the real width when it takes over.
 */
const STATIC_SCORE_WIDTH = 1024;

/** The stored file could not be read to the end. */
export class StaticScoreReadError extends S.TaggedError<
  StaticScoreReadError,
  { readonly brand: unique symbol }
>()("StaticScoreReadError", { cause: S.Defect() }) {}

/**
 * Draws stored notation files as static SVG scores on the server, so a page shows the music
 * before the player has loaded, and prints it with whole systems on each page.
 */
export class StaticScores extends Context.Service<StaticScores>()("dfg-rocks/staticScores", {
  make: Effect.gen(function* () {
    const storage = yield* Storage;
    return {
      /**
       * Draws one track of a stored score. It checks no access: take the location from
       * `Files.locate`, which runs as the visitor.
       */
      draw: Effect.fn("StaticScores.draw")(function* (
        location: StorageLocation,
        trackIndex: number,
      ) {
        const stream = yield* storage.open(location);
        const bytes = yield* Effect.tryPromise({
          try: () => new Response(stream).bytes(),
          catch: (cause) => new StaticScoreReadError({ cause }),
        });
        return yield* renderScoreSvg(
          { _tag: "ScoreFile", bytes },
          { width: STATIC_SCORE_WIDTH, tracks: [trackIndex] },
        );
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(Storage.layer));
}
