import { test, expect, getPw } from "./helpers.js";

test.describe("authentication", () => {
  test("shows login page", async ({ page }) => {
    await page.goto("/login");
    await expect(getPw(page, "login-page")).toBeVisible();
    await expect(getPw(page, "login-id")).toBeVisible();
    await expect(getPw(page, "login-password")).toBeVisible();
    await expect(getPw(page, "login-submit")).toBeVisible();
  });

  test("shows error on invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await getPw(page, "login-id").fill("nobody");
    await getPw(page, "login-password").fill("wrongpassword");
    await getPw(page, "login-submit").click();
    await expect(getPw(page, "login-error")).toBeVisible();
  });

  test("login navigates to dashboard", async ({ page, testing }) => {
    await testing.login({ username: "test_loginflow", role: "admin" });
    await page.goto("/login");
    await getPw(page, "login-id").fill("test_loginflow");
    await getPw(page, "login-password").fill("testpassword123");
    await getPw(page, "login-submit").click();
    await expect(getPw(page, "dashboard")).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
