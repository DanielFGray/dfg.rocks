#!/usr/bin/env bun
/**
 * The development process: serves the app through Vite and runs the job runner, as one Effect
 * layer graph. runMain closes the graph on SIGTERM and SIGINT.
 */
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Layer } from "effect";
import { serveSite } from "./shell/site.js";
import { ViteSite } from "./shell/vite.js";

const site = ViteSite.pipe(Layer.provide(BunServices.layer));

BunRuntime.runMain(Layer.launch(serveSite(site, { host: "127.0.0.1" })));
