import { Context, Effect, Layer } from "effect";
import { applicationLayer } from "./runtime.js";
import { OtlpLive } from "./tracing.js";
import { InProcessApi } from "./inProcessApi.js";
import { Worker } from "../worker/worker.js";

/** Builds one generation of the application and closes its worker before its services. */
export class App extends Context.Service<App>()("dfg-rocks/app", {
  make: Effect.gen(function* () {
    const services = yield* Layer.build(
      InProcessApi.layer.pipe(
        Layer.provideMerge(Worker.layer),
        Layer.provideMerge(applicationLayer),
        // Merged, not provided: the OTLP logger is a service with a default, not a
        // requirement, so merging is what keeps it in the context the API handler
        // (captured below), the server functions and the worker's jobs run on. With
        // the OTEL_* variables unset the layer exports nothing.
        Layer.provideMerge(OtlpLive),
      ),
    );
    return { api: Context.get(services, InProcessApi).handler, services };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
