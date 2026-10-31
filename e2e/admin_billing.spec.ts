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
    await testing.login({
      username: "teacher_no_billing",
      role: "teacher",
      name: "Teacher NoBilling",
      email: "teacher@test.local",
    });
    await loginViaUi(page, "teacher_no_billing", "testpassword123");
    await expect(page.getByTestId("nav-billing")).not.toBeVisible();
  });

  test("billing page lists each payer with the students they pay for", async ({
    page,
    testing,
  }) => {
    await testing.login();
    await testing.login({
      username: "family_parent",
      role: "parent",
      name: "Family Parent",
      email: "family-parent@test.local",
    });
    await testing.login({
      username: "family_student",
      role: "student",
      name: "Family Student",
      email: "family@test.local",
    });
    await testing.seedFamily({
      name: "Billing Family",
      slug: "billing-family",
      owner_username: "family_parent",
    });
    await testing.seedFamilyMembership({
      username: "family_student",
      family_slug: "billing-family",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-billing").click();
    await expect(page.getByTestId("nav-billing")).toBeVisible();
    const payerRow = page.locator("table tr", { hasText: "Family Parent" });
    await expect(payerRow).toContainText("Family Student");
  });

  test("admin can navigate to payer billing detail", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "nav_student",
      role: "student",
      name: "Nav Student",
      email: "nav@test.local",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-billing").click();
    await expect(page.getByTestId("nav-billing")).toBeVisible();

    // A student with no family pays for themself.
    await page.locator("table a", { hasText: "Nav Student" }).click();
    await expect(page.getByTestId("payer-billing-detail")).toBeVisible();
  });
});
