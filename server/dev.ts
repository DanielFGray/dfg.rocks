#!/usr/bin/env bun
// @entrypoint: process entry.
/**
 * The development process: serves the app through Vite and runs the job runner, as one Effect
 * layer graph. runMain closes the graph on SIGTERM and SIGINT.
 */
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Layer } from "effect";
import { Site, serveSite } from "./shell/site.js";

const site = Site.layerVite.pipe(Layer.provide(BunServices.layer));

BunRuntime.runMain(Layer.launch(serveSite(site, { host: "127.0.0.1" })));
