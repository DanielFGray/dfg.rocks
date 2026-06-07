import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as HttpApiClient from "@effect/platform/HttpApiClient";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import { Layer, ManagedRuntime } from "effect";
import { clientApi } from "../../shared/httpApi.js";

const clientLayer = Layer.mergeAll(
  FetchHttpClient.layer,
  Layer.succeed(FetchHttpClient.RequestInit, {
    credentials: "include",
  } satisfies RequestInit),
);

const clientRuntime = ManagedRuntime.make(clientLayer);

export const api = clientRuntime.runSync(
  HttpApiClient.make(clientApi, {
    transformClient: HttpClient.mapRequest(
      HttpClientRequest.setHeader("X-Requested-With", "dfg"),
    ),
  }),
);

export type ApiClient = typeof api;
