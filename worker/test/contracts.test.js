// @ts-check
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { basename } from "node:path";
import { Context, Effect } from "effect";
import { runPlatform } from "../../server/test/framework.ts";
import { WorkerTasks } from "../workerTasks.ts";
import { EmailDelivery } from "../email/emailDelivery.ts";
import { CalendarSync } from "../calendar/calendarSync.ts";

// Every queued job needs a task file or an Effect handler registered by the runner.

const root = new URL("../../", import.meta.url).pathname;

/** @param {string} pattern */
const files = (pattern) => [...new Glob(pattern).scanSync({ cwd: root })].sort();

/** @param {string} pattern */
const names = (pattern) => files(pattern).map((f) => basename(f).replace(/\.\w+$/, ""));

/** @param {string} path */
const read = (path) => Bun.file(root + path).text();

describe("worker contracts", () => {
  test("every queued job name has a registered handler", async () => {
    const queueCall = /add_job["']?[,(\s[]*(?:eb\.val\()?["'](\w+)["']/g;
    const queued = new Set();
    for (const path of [
      ...files("migrations/committed/*.sql"),
      ...files("migrations/current/*.sql"),
      ...files("server/**/*.ts"),
      ...files("worker/tasks/*.js"),
    ]) {
      for (const [, name] of (await read(path)).matchAll(queueCall)) queued.add(name);
    }
    expect(queued.size).toBeGreaterThan(0);

    const registered = await runPlatform(
      WorkerTasks.make.pipe(
        Effect.provideContext(
          Context.make(EmailDelivery, { send: () => Effect.void }).pipe(
            Context.add(CalendarSync, { sync: () => Effect.void }),
          ),
        ),
      ),
    );
    const tasks = new Set([...names("worker/tasks/*.js"), ...Object.keys(registered)]);
    expect([...queued].filter((name) => !tasks.has(name))).toEqual([]);
  });

  test("every template named in worker/tasks exists in worker/templates", async () => {
    const templateRef = /template: "([\w.]+\.mjml)"/g;
    const referenced = new Set();
    for (const path of [...files("worker/tasks/*.js"), ...files("server/**/*.ts")]) {
      for (const [, name] of (await read(path)).matchAll(templateRef)) referenced.add(name);
    }
    expect(referenced.size).toBeGreaterThan(0);

    const templates = new Set(files("worker/templates/*.mjml").map((f) => basename(f)));
    expect([...referenced].filter((name) => !templates.has(name))).toEqual([]);
  });
});
