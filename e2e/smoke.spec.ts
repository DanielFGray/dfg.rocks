import { test, expect, loginViaUi } from "./helpers.js";

test("smoke test", async ({ page, testing }) => {
  await testing.login();
  await loginViaUi(page, "test_admin", "testpassword123");

  // Test client-side nav to courses
  await page.getByTestId("nav-courses").click();
  await expect(page).toHaveURL(/\/courses/);
  await expect(page.getByRole("heading", { name: "Courses" })).toBeVisible();
});
