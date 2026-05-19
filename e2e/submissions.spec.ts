import { test, expect, loginViaUi } from "./helpers.js";

test.describe("submissions", () => {
  test("submissions page renders", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-submissions").click();
    await expect(page.getByTestId("submissions")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contact Submissions" })).toBeVisible();
  });
});
