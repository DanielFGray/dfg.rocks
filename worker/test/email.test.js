import { afterAll, describe, expect, test } from "bun:test";
import { WorkerJobs } from "../worker.ts";
import { jobRun, workerTestRuntime } from "./jobs.ts";

const runtime = workerTestRuntime();
afterAll(() => runtime.dispose());

describe("send_email job decoding", () => {
  test("rejects variables that do not match the template before delivery", async () => {
    const jobs = await runtime.runPromise(WorkerJobs);
    await expect(
      jobs.send_email(
        {
          options: { to: "player@example.invalid", subject: "Subject" },
          template: "password_reset.mjml",
          variables: { email: "player@example.invalid" },
        },
        jobRun("send_email"),
      ),
    ).rejects.toThrow('["variables"]["token"]');
  });
});
