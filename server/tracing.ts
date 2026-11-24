import { Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Otlp from "effect/observability/Otlp";
import * as OtlpSerialization from "effect/observability/OtlpSerialization";

/**
 * Exports Effect telemetry to an OTLP collector. For logs, set
 * `OTEL_LOGS_EXPORTER=otlp` and configure either the shared collector endpoint
 * or the logs endpoint.
 *
 * The service name is fixed here, not left to each deployment, because it is
 * what telemetry lists group by. The other loggers stay installed, so the
 * console keeps its output.
 */
export const OtlpLive = Otlp.layerFromConfig({
  resource: { serviceName: "dfg.rocks" },
}).pipe(
  Layer.provide(OtlpSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer),
);
