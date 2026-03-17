import {
  HttpApiBuilder,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import type { HttpApp } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpApiLive } from "./server.js";
import { handleFileRoutes } from "./fileRoutes.js";
import { TelemetryLive } from "../telemetry.js";
import { SessionService } from "../services/sessionService.js";
import { FileService } from "../services/fileService.js";
import { PgRootDB } from "../db.js";
import { env } from "../assertEnv.js";

const PORT = parseInt(env.PORT);

const ApiLive =
  env.NODE_ENV !== "production"
    ? (await import("./testingApi.js")).TestingApiLive
    : HttpApiLive;

/**
 * Middleware that intercepts file upload/download routes before
 * passing through to the HttpApi handler.
 */
const fileRoutesMiddleware = (
  httpApp: HttpApp.Default,
): HttpApp.Default<never, PgRootDB | SessionService | FileService> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const webRequest = request.source as Request;

    const fileResponse = yield* handleFileRoutes(webRequest).pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    );

    if (fileResponse !== null) {
      return HttpServerResponse.fromWeb(fileResponse);
    }

    // Pass through to normal HttpApi handler
    return yield* httpApp;
  });

const FileServiceDeps = Layer.mergeAll(
  FileService.Default,
  SessionService.Default,
  PgRootDB.Live,
);

const ServerLive = HttpApiBuilder.serve(fileRoutesMiddleware).pipe(
  Layer.provide(ApiLive),
  Layer.provide(FileServiceDeps),
  Layer.provide(BunHttpServer.layer({ port: PORT, hostname: "0.0.0.0" })),
  Layer.provide(TelemetryLive),
);

export function runWebServer() {
  Effect.log(`Server running at http://localhost:${PORT}`).pipe(
    Effect.flatMap(() => Layer.launch(ServerLive)),
    Effect.orDie,
    BunRuntime.runMain,
  );
}
