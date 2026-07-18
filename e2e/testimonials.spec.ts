import { test, expect, loginViaUi } from "./helpers.js";

test.describe("testimonial flow", () => {
  test("student posts, admin approves, then appears on public homepage", async ({
    page,
    testing,
  }) => {
    await testing.login({
      username: "test_student",
      role: "student",
      email: "student@test.local",
    });
    await testing.setTestimonialReminder({
      username: "test_student",
      prompt_enabled: true,
      next_prompt_at: new Date().toISOString(),
    });
    await loginViaUi(page, "test_student", "testpassword123");

    const body =
      "My son has been taking drum lessons for six months and his growth has been incredible. Highly recommend!";
    await expect(page.getByTestId("testimonial-prompt")).toBeVisible();
    await page.getByTestId("testimonial-textarea").fill(body);
    await page.getByTestId("save-testimonial").click();
    await expect(page.getByTestId("testimonial-prompt")).not.toBeVisible();

    await page.getByTestId("logout").click();

    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");

    await page.getByTestId("nav-settings").click();
    await expect(page.getByTestId("testimonial-review-section")).toBeVisible();
    await expect(page.getByTestId("testimonial-review-card")).toBeVisible();
    await expect(page.getByTestId("testimonial-review-card").first()).toContainText(body);
    await page.getByTestId("approve-testimonial").click();
    await expect(page.getByText("Approved")).toBeVisible();

    await page.goto("/");
    await expect(page.getByTestId("testimonial-section")).toBeVisible();
    await expect(page.getByTestId("testimonial-section")).toContainText(body);
  });
});
