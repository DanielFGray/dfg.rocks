import { Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Otlp from "effect/observability/Otlp";
import * as OtlpSerialization from "effect/observability/OtlpSerialization";

/**
 * Exports the logs that Effect creates to an OTLP collector. A signal exports
 * only when the collector is set (`OTEL_EXPORTER_OTLP_ENDPOINT`) and that
 * signal's exporter list names otlp: `OTEL_LOGS_EXPORTER=otlp`. The endpoint
 * alone exports nothing.
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
