import { Config } from "effect";

// Cwd-relative because production runs the bundled server from /app and copies worker/ to /app/worker.
export const WorkerDirectory = Config.NonEmptyString("WORKER_DIR").pipe(
  Config.withDefault("worker"),
);
