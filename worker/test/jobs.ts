// @entrypoint: worker tests invoke graphile callbacks through their captured service context.
import { NodeServices } from "@effect/platform-node";
import { ConfigProvider, Effect, Layer, ManagedRuntime, Schema } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type { JobInfo } from "@danielfgray/stompbox/worker";
import { WorkerJobs } from "../worker.js";
import { testDatabaseEnv } from "../../scripts/testDatabase.js";

/** Builds the production job list without starting a runner. */
export const workerTestLayer = WorkerJobs.layer.pipe(
  Layer.provide(NodeServices.layer),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        ...process.env,
        ...testDatabaseEnv(),
        MAIL_PROVIDER: "capture",
      }),
    ),
  ),
);

export const jobRun = (name: string, queuedAt = new Date()): JobInfo => ({
  abortSignal: new AbortController().signal,
  job: { id: "test-job", task_identifier: name, attempts: 1, created_at: queuedAt },
});

export class JobTestError extends Schema.TaggedError<
  JobTestError,
  { readonly brand: unique symbol }
>()("JobTestError", { cause: Schema.Defect() }) {}

/** The same callback graphile invokes, with production service implementations. */
export const runWorkerJob = <K extends keyof WorkerJobs["Service"]>(
  name: K,
  payload: unknown,
  queuedAt = new Date(),
) =>
  WorkerJobs.use((jobs) =>
    Effect.tryPromise({
      try: () => jobs[name](payload, jobRun(name, queuedAt)),
      catch: (cause) => new JobTestError({ cause }),
    }),
  ).pipe(Effect.provide(workerTestLayer));

/** Bun's asynchronous test boundary shares one scoped job context. */
export const workerTestRuntime = () => ManagedRuntime.make(workerTestLayer);
