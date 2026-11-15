import { Context, Effect, Layer } from "effect";
import { applicationLayer } from "./runtime.js";
import { InProcessApi } from "./inProcessApi.js";
import { Worker } from "../worker/worker.js";

/** Builds one generation of the application and closes its worker before its services. */
export class App extends Context.Service<App>()("dfg-rocks/app", {
  make: Effect.gen(function* () {
    const services = yield* Layer.build(
      InProcessApi.layer.pipe(
        Layer.provideMerge(Worker.layer),
        Layer.provideMerge(applicationLayer),
      ),
    );
    return { api: Context.get(services, InProcessApi).handler, services };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
