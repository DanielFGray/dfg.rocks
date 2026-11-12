import { Context, Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import { applicationLayer, HttpApiLive } from "./runtime.js";
import { BackgroundWorker } from "./services/backgroundWorker.js";

/** Builds one generation of the application and closes its worker before its services. */
export class App extends Context.Service<App>()("dfg-rocks/app", {
  make: Effect.gen(function* () {
    const services = yield* Layer.build(
      BackgroundWorker.layer.pipe(Layer.provideMerge(applicationLayer)),
    );
    const api = yield* HttpRouter.toHttpEffect(HttpApiLive).pipe(Effect.provideContext(services));
    return { api: api.pipe(Effect.provideContext(services)), services };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
