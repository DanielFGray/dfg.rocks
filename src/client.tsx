import "./styles.css";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import { pipe } from "effect/Function";
import { render } from "fibrae";
import { BrowserHistoryLive, NavigatorLive } from "fibrae/router";
import { BrowserRuntime } from "@effect/platform-browser";

import { router, handlersLayer, App } from "./app.js";
import { DfgApi } from "./portal/api.js";

const appLayer = pipe(
  NavigatorLive(router),
  Layer.provideMerge(BrowserHistoryLive),
  Layer.provideMerge(handlersLayer),
  Layer.provideMerge(DfgApi.layer),
);

Effect.gen(function* () {
  const root = pipe(
    document.getElementById("root"),
    Option.fromNullable,
    Option.getOrThrow,
  );
  return yield* render(<App />, root, { layer: appLayer });
}).pipe(
  Effect.catchAllDefect((e) => {
    console.error("Fibrae defect:", e);
    return Effect.log(e);
  }),
  BrowserRuntime.runMain,
);
