#!/usr/bin/env bun
// @entrypoint: process entry.
/**
 * The production process: serves the build and runs the job runner, as one Effect layer graph.
 * runMain closes the graph on SIGTERM and SIGINT.
 *
 * This file and server/shell/ run from source in the image, beside dist/. They import the
 * application only through the bundle, so each application module is loaded once.
 */
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as BunHttpPlatform from "@effect/platform-bun/BunHttpPlatform";
import { Layer } from "effect";
import { Site, serveSite } from "./shell/site.js";

const site = Site.layerBuilt.pipe(
  Layer.provide(Layer.mergeAll(BunServices.layer, BunHttpPlatform.layer)),
);

BunRuntime.runMain(Layer.launch(serveSite(site, { host: "0.0.0.0" })));
