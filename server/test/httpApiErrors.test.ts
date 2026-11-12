import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as Etag from "effect/http/Etag";
import * as HttpRouter from "effect/http/HttpRouter";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import {
  BadRequestError,
  BadRequestErrorSchema,
  HttpApiErrorSchemas,
  InternalServerError,
} from "../../shared/httpApiErrors.js";
import { adaptHttpApiErrors, httpErrorToHttpApiError } from "../httpApiErrors.js";
import { HttpError } from "../pgErrors.js";

const statuses = [400, 401, 403, 404, 409, 413, 423, 429, 500, 502, 503] as const;

describe("HTTP API error schemas", () => {
  it.effect("encodes a tagged variant with the existing wire body", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(BadRequestErrorSchema)(
        new BadRequestError({ error: "Invalid request" }),
      );

      expect(encoded).toEqual({ error: "Invalid request" });
      expect(encoded).not.toHaveProperty("_tag");
    }),
  );

  it.effect("decodes the wire body into the status-specific tagged variant", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeEffect(BadRequestErrorSchema)({
        error: "Invalid request",
      });

      expect(decoded).toBeInstanceOf(BadRequestError);
      expect(decoded).toMatchObject({ _tag: "BadRequestError", error: "Invalid request" });
    }),
  );
});

describe("HTTP API error adapter", () => {
  it.each(statuses)("adapts HttpError status %i", async (status) => {
    const apiError = httpErrorToHttpApiError(
      new HttpError({ status: status, message: `status ${status}` }),
    );

    expect(apiError).toMatchObject({
      error: status === 500 ? "Internal Server Error" : `status ${status}`,
    });
  });

  it.effect("converts a disallowed HttpError status to a sanitized 500", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        adaptHttpApiErrors(
          Effect.fail(new HttpError({ status: 403, message: "private details" })),
          [400],
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.findErrorOption(exit.cause)).toMatchObject({
          _tag: "Some",
          value: new InternalServerError({ error: "Internal Server Error" }),
        });
      }
    }),
  );

  it.effect("preserves an already-adapted HttpApiError failure", () =>
    Effect.gen(function* () {
      const error = new BadRequestError({ error: "Already adapted" });
      const exit = yield* Effect.exit(adaptHttpApiErrors(Effect.fail(error), [400]));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.findErrorOption(exit.cause)).toMatchObject({ _tag: "Some", value: error });
      }
    }),
  );

  it.effect("sanitizes an allowed HttpError status 500", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        adaptHttpApiErrors(
          Effect.fail(new HttpError({ status: 500, message: "database password" })),
          [500],
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.findErrorOption(exit.cause)).toMatchObject({
          _tag: "Some",
          value: new InternalServerError({ error: "Internal Server Error" }),
        });
      }
    }),
  );

  it.effect("logs and sanitizes an unknown defect", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        adaptHttpApiErrors(Effect.die("database password"), statuses),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.findErrorOption(exit.cause)).toMatchObject({
          _tag: "Some",
          value: new InternalServerError({ error: "Internal Server Error" }),
        });
      }
    }),
  );

  it.effect("preserves interruption", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(adaptHttpApiErrors(Effect.interrupt, statuses));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasInterrupts(exit.cause)).toBe(true);
        expect(Cause.findErrorOption(exit.cause)._tag).toBe("None");
      }
    }),
  );
});

describe("HttpApiBuilder status encoding", () => {
  it("uses every declared status and preserves the JSON body", async () => {
    const path = Schema.Struct({ status: Schema.FiniteFromString });
    const [
      badRequest,
      unauthorized,
      forbidden,
      notFound,
      conflict,
      payloadTooLarge,
      locked,
      tooManyRequests,
      internalServer,
      badGateway,
      serviceUnavailable,
    ] = HttpApiErrorSchemas;
    const endpoint = HttpApiEndpoint.get("fail", "/fail/:status", {
      params: path,
      error: [
        badRequest,
        unauthorized,
        forbidden,
        notFound,
        conflict,
        payloadTooLarge,
        locked,
        tooManyRequests,
        internalServer,
        badGateway,
        serviceUnavailable,
      ],
    });

    const group = HttpApiGroup.make("errors").add(endpoint);
    const api = HttpApi.make("error-test").add(group);
    const allowedStatuses = new Set(statuses);
    const routes = HttpApiBuilder.group(api, "errors", (handlers) =>
      handlers.handle("fail", ({ params }) =>
        adaptHttpApiErrors(
          Effect.fail(new HttpError({ status: params.status, message: `status ${params.status}` })),
          allowedStatuses,
        ),
      ),
    );
    const apiLayer = HttpApiBuilder.layer(api).pipe(
      Layer.provide(routes),
      Layer.provide(
        Layer.mergeAll(NodeHttpPlatform.layer, NodeFileSystem.layer, NodePath.layer, Etag.layer),
      ),
    );
    const { dispose, handler } = HttpRouter.toWebHandler(apiLayer, { disableLogger: true });

    try {
      for (const status of statuses) {
        const response = await handler(new Request(`http://localhost/fail/${status}`));

        expect(response.status).toBe(status);
        await expect(response.json()).resolves.toEqual({
          error: status === 500 ? "Internal Server Error" : `status ${status}`,
        });
      }
    } finally {
      await dispose();
    }
  });
});
