import { test, expect, loginViaUi } from "./helpers.js";

test.describe("dashboard", () => {
  test("hides testimonial prompt for a new student", async ({ page, testing }) => {
    await testing.login({
      username: "test_prompt_hidden",
      role: "student",
      email: "prompt-hidden@test.local",
    });

    await loginViaUi(page, "test_prompt_hidden", "testpassword123");
    await expect(page.getByTestId("testimonial-prompt")).not.toBeVisible();
  });

  test("shows testimonial prompt after reminders are enabled", async ({ page, testing }) => {
    await testing.login({
      username: "test_prompt_ready",
      role: "student",
      email: "prompt-ready@test.local",
    });
    await testing.setTestimonialReminder({
      username: "test_prompt_ready",
      prompt_enabled: true,
      next_prompt_at: new Date().toISOString(),
    });

    await loginViaUi(page, "test_prompt_ready", "testpassword123");
    await expect(page.getByTestId("testimonial-prompt")).toBeVisible();
  });

  test("shows parent onboarding when parent has no students", async ({ page, testing }) => {
    await testing.login({
      username: "test_onboard",
      role: "parent",
      email: "onboard@test.local",
    });
    await testing.seedFamily({
      slug: "test-onboard-fam",
      name: "Onboard Family",
      owner_username: "test_onboard",
    });

    await loginViaUi(page, "test_onboard", "testpassword123");
    await expect(page.getByTestId("parent-onboarding")).toBeVisible();
    await expect(page.getByTestId("add-student-submit")).toBeVisible();
  });

  test("parent can add a student via API and onboarding disappears", async ({
    page,
    testing,
  }) => {
    const pendingServerFunctions = new Set<string>();
    page.on("request", (request) => {
      if (request.url().includes("/_serverFn/")) pendingServerFunctions.add(request.url());
    });
    const markServerFunctionSettled = (request: { url(): string }) => {
      pendingServerFunctions.delete(request.url());
    };
    page.on("requestfinished", markServerFunctionSettled);
    page.on("requestfailed", markServerFunctionSettled);
    await testing.login({
      username: "test_addchild_v2",
      role: "parent",
      email: "addchild2@test.local",
    });
    await testing.seedFamily({
      slug: "test-addchild2-fam",
      name: "AddChild2 Family",
      owner_username: "test_addchild_v2",
    });

    await loginViaUi(page, "test_addchild_v2", "testpassword123");
    await expect(page.getByTestId("parent-onboarding")).toBeVisible();
    await expect.poll(() => pendingServerFunctions.size).toBe(0);

    const res = await page.request.post(new URL("/api/create-child", page.url()).toString(), {
      data: { name: "Jane Doe" },
      headers: { "Content-Type": "application/json", "X-Requested-With": "dfg" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.username).toMatch(/^jane_doe/);
    expect(body.role).toBe("student");
    await expect.poll(() => pendingServerFunctions.size).toBe(0);

    await page.goto("/dashboard");
    await expect(page.getByTestId("parent-onboarding")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("dashboard")).toBeVisible();
  });
});
