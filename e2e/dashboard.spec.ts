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
});
