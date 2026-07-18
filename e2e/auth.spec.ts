import { test, expect, loginViaUi } from "./helpers.js";

test.describe("authentication", () => {
  test("shows login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByTestId("login-id")).toBeVisible();
    await expect(page.getByTestId("login-password")).toBeVisible();
    await expect(page.getByTestId("login-submit")).toBeVisible();
  });

  test("shows error on invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("login-id").fill("nobody");
    await page.getByTestId("login-password").fill("wrongpassword");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toBeVisible();
  });

  test("login navigates to dashboard", async ({ page, testing }) => {
    await testing.login({ username: "test_loginflow", role: "admin" });
    await loginViaUi(page, "test_loginflow", "testpassword123");
    await expect(page.getByTestId("dashboard")).toBeVisible();
  });

  test("unauthenticated redirect preserves target url", async ({ page, testing }) => {
    await testing.login({ username: "test_redirect_after_login", role: "student" });
    await page.context().clearCookies();

    await page.goto("/settings");
    await expect(page.getByTestId("login-page")).toBeVisible();

    await page.getByTestId("login-id").fill("test_redirect_after_login");
    await page.getByTestId("login-password").fill("testpassword123");
    await page.getByTestId("login-submit").click();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("settings")).toBeVisible();
  });

  test("oauth buttons preserve redirect target", async ({ page, testing }) => {
    await testing.login({ username: "test_oauth_redirects", role: "student" });
    await page.context().clearCookies();

    await page.goto("/settings");
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByTestId("google-oauth")).toHaveAttribute(
      "href",
      "/api/oauth/google?redirect=%2Fsettings",
    );
    await expect(page.getByTestId("apple-oauth")).toHaveCount(0);
  });
});
