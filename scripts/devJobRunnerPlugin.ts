import path from "node:path";
import { isRunnableDevEnvironment, type Plugin } from "vite";

type ServerEntry = (typeof import("../app/server.js"))["default"];

/**
 * Starts the job runner inside the dev server, as serve.ts does in production: the runner lives in
 * the process that serves the app, and nowhere else.
 *
 * The server entry is imported through the SSR environment's module runner, the same one TanStack
 * Start imports it through for each request, so the runner shares the request handler's runtime.
 * A module the runner already loaded keeps its first version: after an edit to the job code,
 * restart the dev server.
 */
export function devJobRunnerPlugin(): Plugin {
  let started: Promise<ServerEntry> | undefined;
  return {
    name: "dfg:dev-job-runner",
    apply: "serve",
    configureServer(server) {
      const workerDirectory = path.resolve(server.config.root, "worker");
      server.httpServer?.once("listening", () => {
        const environment = server.environments.ssr;
        if (!isRunnableDevEnvironment(environment)) {
          server.config.logger.error("The job runner needs a runnable SSR environment");
          return;
        }
        started = environment.runner
          .import<{ default: ServerEntry }>("/app/server.ts")
          .then(async ({ default: app }) => {
            await app.startWorker(workerDirectory);
            return app;
          });
        started.catch((error) => server.config.logger.error(`Job runner did not start: ${error}`));
      });
      // Vite closes the server on SIGTERM but not on SIGINT (Ctrl-C), which would end the process
      // with the runner still holding its jobs. Route SIGINT into the same close, as Vite does for
      // SIGTERM. A restart closes this server and builds another, so the handler goes with it.
      const onInterrupt = () => {
        void server.close().finally(() => {
          process.exitCode ??= 130;
          process.exit();
        });
      };
      process.once("SIGINT", onInterrupt);
      server.httpServer?.once("close", () => process.off("SIGINT", onInterrupt));
    },
    // Vite awaits this hook when the dev server closes: on SIGTERM, SIGINT, stdin end and restart.
    // Disposing the runtime stops the runner, as serve.ts does, so no job is left locked.
    async closeBundle() {
      if (this.environment.name !== "ssr" || started === undefined) return;
      const app = await started.catch(() => undefined); // a failed start is logged above
      started = undefined;
      await app?.dispose();
    },
  };
}
