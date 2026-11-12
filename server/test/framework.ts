// @entrypoint: Vitest and bun:test callbacks enter Effects through this adapter.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";

/** Runs a framework callback with the platform services it needs. */
export const runPlatform = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

/** The HTTP client installed by the API test's in-process transport. */
export const testClient = (client: HttpClient.HttpClient) => {
  const runtime = ManagedRuntime.make(Layer.succeed(HttpClient.HttpClient, client));
  return {
    request: (request: HttpClientRequest.HttpClientRequest) =>
      runtime.runPromise(HttpClient.execute(request)),
    json: (response: HttpClientResponse.HttpClientResponse) => runtime.runPromise(response.json),
    text: (response: HttpClientResponse.HttpClientResponse) => runtime.runPromise(response.text),
    dispose: () => runtime.dispose(),
  };
};
