// @ts-check
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { basename } from "node:path";

// graphile-worker runs a job only when a file in worker/tasks carries its name; a
// job with no file stays queued forever without an error. The queue sites live in
// SQL and server TypeScript, so this guard scans their source.

const root = new URL("../../", import.meta.url).pathname;

/** @param {string} pattern */
const files = (pattern) => [...new Glob(pattern).scanSync({ cwd: root })].sort();

/** @param {string} pattern */
const names = (pattern) => files(pattern).map((f) => basename(f).replace(/\.\w+$/, ""));

/** @param {string} path */
const read = (path) => Bun.file(root + path).text();

describe("worker contracts", () => {
  test("every queued job name has a file in worker/tasks", async () => {
    const queueCall = /add_job["']?[,(\s[]*(?:eb\.val\()?["'](\w+)["']/g;
    const queued = new Set();
    for (const path of [...files("migrations/committed/*.sql"), ...files("server/**/*.ts")]) {
      for (const [, name] of (await read(path)).matchAll(queueCall)) queued.add(name);
    }
    expect(queued.size).toBeGreaterThan(0);

    const tasks = new Set(names("worker/tasks/*.js"));
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
