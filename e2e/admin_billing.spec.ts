import { test, expect, loginViaUi } from "./helpers.js";

test.describe("admin billing", () => {
  test("admin sees billing nav and AR summary", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "billing_student",
      role: "student",
      name: "Billing Test",
      email: "billing@test.local",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-billing").click();
    await expect(page).toHaveURL(/\/billing/);
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  });

  test("teacher does not see billing nav", async ({ page, testing }) => {
    await testing.login({ username: "teacher_no_billing", role: "teacher", name: "Teacher NoBilling", email: "teacher@test.local" });
    await loginViaUi(page, "teacher_no_billing", "testpassword123");
    await expect(page.getByTestId("nav-billing")).not.toBeVisible();
  });

  test("billing page loads families for admin", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "family_student",
      role: "student",
      name: "Family Student",
      email: "family@test.local",
    });
    await testing.seedFamily({ name: "Billing Family", owner_username: "family_student" });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-billing").click();
    await expect(page.getByTestId("nav-billing")).toBeVisible();
    await expect(page.locator("table")).toContainText("Billing Family");
  });

  test("admin can navigate to family billing detail", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "nav_student",
      role: "student",
      name: "Nav Student",
      email: "nav@test.local",
    });
    await testing.seedFamily({ name: "Nav Family", owner_username: "nav_student" });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-billing").click();
    await expect(page.getByTestId("nav-billing")).toBeVisible();

    await page.locator("table a", { hasText: "Nav Family" }).click();
    await expect(page.getByTestId("family-billing-detail")).toBeVisible();
  });
});
