import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Config, Effect } from "effect";
import { HealthUnavailableError, healthGroup } from "../../shared/httpApi.js";
import { PgAuthDB } from "../db.js";
import { BackgroundWorker } from "../services/backgroundWorker.js";

export const healthApi = HttpApi.make("dfg").add(healthGroup);

// How long the database check may take before the platform sees the app as down.
const DATABASE_CHECK_TIMEOUT = "2 seconds";

export function makeHealthLayer() {
  return HttpApiBuilder.group(healthApi, "health", (handlers) =>
    Effect.map(Config.NonEmptyString("GIT_COMMIT").pipe(Config.withDefault("unknown")), (commit) =>
      handlers.handle(
        "healthz",
        Effect.fnUntraced(function* () {
          const db = yield* PgAuthDB;
          const databaseDown = yield* db.execute(db.selectNoFrom((eb) => eb.lit(1).as("one"))).pipe(
            Effect.timeout(DATABASE_CHECK_TIMEOUT),
            Effect.as(false),
            Effect.catch((cause) =>
              Effect.logError("Health check: database unreachable", cause).pipe(Effect.as(true)),
            ),
          );
          const worker = yield* BackgroundWorker;
          const workerFailed = yield* worker.failed;
          const failed = [
            ...(databaseDown ? ["database"] : []),
            ...(workerFailed ? ["worker"] : []),
          ];
          if (failed.length > 0) {
            return yield* new HealthUnavailableError({ commit, failed });
          }
          return { status: "ok" as const, commit };
        }),
      ),
    ),
  );
}
