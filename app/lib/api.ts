import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { Layer, ManagedRuntime } from "effect";
import { Contract } from "../../shared/httpApi.js";

const clientLayer = Layer.mergeAll(
  FetchHttpClient.layer,
  Layer.succeed(FetchHttpClient.RequestInit, {
    credentials: "include",
  } satisfies RequestInit),
);

const clientRuntime = ManagedRuntime.make(clientLayer);

export const api = clientRuntime.runSync(
  HttpApiClient.make(Contract, {
    transformClient: HttpClient.mapRequest(HttpClientRequest.setHeader("X-Requested-With", "dfg")),
  }),
);

export type ApiClient = typeof api;
