import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
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
  it("encodes a tagged variant with the existing wire body", async () => {
    const encoded = await Effect.runPromise(
      Schema.encode(BadRequestErrorSchema)(new BadRequestError({ error: "Invalid request" })),
    );

    expect(encoded).toEqual({ error: "Invalid request" });
    expect(encoded).not.toHaveProperty("_tag");
  });

  it("decodes the wire body into the status-specific tagged variant", async () => {
    const decoded = await Effect.runPromise(
      Schema.decodeUnknown(BadRequestErrorSchema)({ error: "Invalid request" }),
    );

    expect(decoded).toBeInstanceOf(BadRequestError);
    expect(decoded).toMatchObject({ _tag: "BadRequestError", error: "Invalid request" });
  });
});

describe("HTTP API error adapter", () => {
  it.each(statuses)("adapts HttpError status %i", async (status) => {
    const apiError = httpErrorToHttpApiError(new HttpError(status, `status ${status}`));

    expect(apiError).toMatchObject({
      error: status === 500 ? "Internal Server Error" : `status ${status}`,
    });
  });

  it("converts a disallowed HttpError status to a sanitized 500", async () => {
    const exit = await Effect.runPromiseExit(
      adaptHttpApiErrors(Effect.fail(new HttpError(403, "private details")), [400]),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.failureOption(exit.cause)).toMatchObject({
        _tag: "Some",
        value: new InternalServerError({ error: "Internal Server Error" }),
      });
    }
  });

  it("preserves an already-adapted HttpApiError failure", async () => {
    const error = new BadRequestError({ error: "Already adapted" });
    const exit = await Effect.runPromiseExit(adaptHttpApiErrors(Effect.fail(error), [400]));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.failureOption(exit.cause)).toMatchObject({ _tag: "Some", value: error });
    }
  });

  it("sanitizes an allowed HttpError status 500", async () => {
    const exit = await Effect.runPromiseExit(
      adaptHttpApiErrors(Effect.fail(new HttpError(500, "database password")), [500]),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.failureOption(exit.cause)).toMatchObject({
        _tag: "Some",
        value: new InternalServerError({ error: "Internal Server Error" }),
      });
    }
  });

  it("logs and sanitizes an unknown defect", async () => {
    const exit = await Effect.runPromiseExit(
      adaptHttpApiErrors(Effect.die("database password"), statuses),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.failureOption(exit.cause)).toMatchObject({
        _tag: "Some",
        value: new InternalServerError({ error: "Internal Server Error" }),
      });
    }
  });

  it("preserves interruption", async () => {
    const exit = await Effect.runPromiseExit(adaptHttpApiErrors(Effect.interrupt, statuses));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.isInterrupted(exit.cause)).toBe(true);
      expect(Cause.failureOption(exit.cause)._tag).toBe("None");
    }
  });
});

describe("HttpApiBuilder status encoding", () => {
  it("uses every declared status and preserves the JSON body", async () => {
    const path = Schema.Struct({ status: Schema.NumberFromString });
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
    const endpoint = HttpApiEndpoint.get("fail", "/fail/:status")
      .setPath(path)
      .addError(badRequest)
      .addError(unauthorized)
      .addError(forbidden)
      .addError(notFound)
      .addError(conflict)
      .addError(payloadTooLarge)
      .addError(locked)
      .addError(tooManyRequests)
      .addError(internalServer)
      .addError(badGateway)
      .addError(serviceUnavailable);

    const group = HttpApiGroup.make("errors").add(endpoint);
    const api = HttpApi.make("error-test").add(group);
    const allowedStatuses = new Set(statuses);
    const routes = HttpApiBuilder.group(api, "errors", (handlers) =>
      handlers.handle("fail", ({ path }) =>
        adaptHttpApiErrors(
          Effect.fail(new HttpError(path.status, `status ${path.status}`)),
          allowedStatuses,
        ),
      ),
    );
    const apiLayer = HttpApiBuilder.api(api).pipe(Layer.provide(routes));
    const { dispose, handler } = HttpApiBuilder.toWebHandler(
      Layer.mergeAll(apiLayer, HttpServer.layerContext),
    );

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
