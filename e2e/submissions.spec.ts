import { test, expect, getCy, loginViaUi } from "./helpers.js";

test.describe("submissions", () => {
  test("admin nav shows submissions link", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await expect(getCy(page, "nav-submissions")).toBeVisible();
  });

  test("submissions page renders", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await getCy(page, "nav-submissions").click();
    await expect(getCy(page, "submissions")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Contact Submissions" }),
    ).toBeVisible();
  });
});
