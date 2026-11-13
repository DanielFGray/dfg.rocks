import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Config, Effect } from "effect";
import { HealthUnavailableError } from "../../shared/api/health.js";
import { Contract } from "../../shared/httpApi.js";
import { PgAuthDB } from "../db.js";
import { Worker } from "../../worker/worker.js";

// How long the database check may take before the platform sees the app as down.
const DATABASE_CHECK_TIMEOUT = "2 seconds";

export const HealthApiGroupLive = HttpApiBuilder.group(Contract, "health", (handlers) =>
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
        const worker = yield* Worker;
        const workerRunning = yield* worker.isRunning;
        const failed = [
          ...(databaseDown ? ["database"] : []),
          ...(!workerRunning ? ["worker"] : []),
        ];
        if (failed.length > 0) {
          return yield* new HealthUnavailableError({ commit, failed });
        }
        return { status: "ok" as const, commit };
      }),
    ),
  ),
);
