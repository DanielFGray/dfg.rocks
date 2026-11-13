// @ts-check
import { afterAll, describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { basename } from "node:path";
import { WorkerJobs } from "../worker.ts";
import { workerTestRuntime, jobRun } from "./jobs.ts";

const runtime = workerTestRuntime();
afterAll(() => runtime.dispose());

// Every queued job needs a typed job in the worker's job list.

const root = new URL("../../", import.meta.url).pathname;

/** @param {string} pattern */
const files = (pattern) => [...new Glob(pattern).scanSync({ cwd: root })].sort();

/** @param {string} pattern */

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
      ...files("worker/**/*.ts").filter(
        (path) => !path.includes("/test/") && !path.endsWith(".test.ts"),
      ),
    ]) {
      for (const [, name] of (await read(path)).matchAll(queueCall)) queued.add(name);
    }
    expect(queued.size).toBeGreaterThan(0);

    const registered = await runtime.runPromise(WorkerJobs);
    const tasks = new Set(Object.keys(registered));
    for (const line of (await read("worker/crontab")).split("\n")) {
      if (line.trim() && !line.startsWith("#")) queued.add(line.trim().split(/\s+/)[5]);
    }
    expect([...queued].filter((name) => !tasks.has(name))).toEqual([]);
  });

  test("every queued template exists in worker/templates", async () => {
    const templateRef = /template: "([\w.]+\.mjml)"/g;
    const referenced = new Set();
    for (const path of [
      ...files("worker/**/*.ts").filter(
        (path) => !path.includes("/test/") && !path.endsWith(".test.ts"),
      ),
      ...files("server/**/*.ts"),
    ]) {
      for (const [, name] of (await read(path)).matchAll(templateRef)) referenced.add(name);
    }
    expect(referenced.size).toBeGreaterThan(0);

    const templates = new Set(files("worker/templates/*.mjml").map((f) => basename(f)));
    expect([...referenced].filter((name) => !templates.has(name))).toEqual([]);
  });
});

describe("worker payload decoding", () => {
  for (const name of [
    "user__audit",
    "user__forgot_password",
    "user__magic_link",
    "user__forgot_password_unregistered_email",
    "user__send_delete_account_email",
    "user_emails__send_verification",
    "family_invitations__send_invite",
    "lessons__generate_prepaid_period",
    "lessons__sync_calendar_event",
    "send_email",
  ]) {
    test(name + " rejects a missing payload before service work", async () => {
      const jobs = await runtime.runPromise(WorkerJobs);
      await expect(jobs[name]({}, jobRun(name))).rejects.toThrow();
    });
  }
});
