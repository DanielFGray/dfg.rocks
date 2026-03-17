import { test, expect, getCy } from "./helpers.js";

test.describe("authentication", () => {
  test("shows login page", async ({ page }) => {
    await page.goto("/login");
    await expect(getCy(page, "login-page")).toBeVisible();
    await expect(getCy(page, "login-id")).toBeVisible();
    await expect(getCy(page, "login-password")).toBeVisible();
    await expect(getCy(page, "login-submit")).toBeVisible();
  });

  test("shows error on invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await getCy(page, "login-id").fill("nobody");
    await getCy(page, "login-password").fill("wrongpassword");
    await getCy(page, "login-submit").click();
    await expect(getCy(page, "login-error")).toBeVisible();
  });

  test("login navigates to dashboard", async ({ page, testing }) => {
    await testing.login({ username: "test_loginflow", role: "admin" });
    await page.goto("/login");
    await getCy(page, "login-id").fill("test_loginflow");
    await getCy(page, "login-password").fill("testpassword123");
    await getCy(page, "login-submit").click();
    await expect(getCy(page, "dashboard")).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
