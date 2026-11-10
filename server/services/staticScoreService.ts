import { renderScoreSvg } from "alphatab-kit/render";
import { Cache, Context, Duration, Effect, Exit, Layer, Schema } from "effect";
import { notationDisplaySettings } from "../../app/components/alphatab/helpers.js";
import { FileService, toStorageLocation } from "./fileService.js";
import { StorageService, type StorageLocation } from "./storageService.js";

/**
 * The width static scores are laid out at: the width the player assumes before
 * it measures its container. The static score scales to its container; the
 * player lays the score out again at the real width when it takes over.
 */
const STATIC_SCORE_WIDTH = 1024;

/** Static scores kept in memory. A long score is up to about 1 MB of SVG. */
const CACHE_CAPACITY = 32;

export class StaticScoreReadError extends Schema.TaggedError<StaticScoreReadError>()(
  "StaticScoreReadError",
  { cause: Schema.Defect() },
) {}

interface StaticScoreKey {
  readonly location: StorageLocation;
  readonly trackIndex: number;
}

/**
 * Draws notation materials as static SVG scores on the server, so pages show
 * the music before the player loads, and print it.
 */
export class StaticScoreService extends Context.Service<StaticScoreService>()(
  "StaticScoreService",
  {
    make: Effect.gen(function* () {
      // Material files never change after upload, so a drawing stays valid
      // for its storage location. Failed lookups are not kept.
      const scores = yield* Cache.makeWith(drawStoredScore, {
        capacity: CACHE_CAPACITY,
        timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
        requireServicesAt: "lookup",
      });
      return {
        /** The material's static score, after the same access check as a download. */
        forMaterial: Effect.fn("StaticScoreService.forMaterial")(function* (
          materialId: string,
          trackIndex: number,
          userId: string,
          sessionId: string,
        ) {
          const material = yield* FileService.use((files) =>
            files.authorize(materialId, userId, sessionId),
          );
          return yield* Cache.get(scores, { location: toStorageLocation(material), trackIndex });
        }),
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}

const drawStoredScore = Effect.fnUntraced(function* ({ location, trackIndex }: StaticScoreKey) {
  const stream = yield* StorageService.use((storage) => storage.open(location));
  const bytes = yield* Effect.tryPromise({
    try: () => new Response(stream).bytes(),
    catch: (cause) => new StaticScoreReadError({ cause }),
  });
  return yield* renderScoreSvg(
    { _tag: "ScoreFile", bytes },
    {
      width: STATIC_SCORE_WIDTH,
      tracks: [trackIndex],
      settings: { display: notationDisplaySettings(STATIC_SCORE_WIDTH, 1, false) },
    },
  );
});
