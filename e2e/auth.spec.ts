import { test, expect } from "./helpers.js";

test.describe("authentication", () => {
  test("shows login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByTestId("login-id")).toBeVisible();
    await expect(page.getByTestId("login-password")).toBeVisible();
    await expect(page.getByTestId("login-submit")).toBeVisible();
  });

  test("shows error on invalid credentials", async ({ page }) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
      await page.getByTestId("login-id").fill("nobody");
      await page.getByTestId("login-password").fill("wrongpassword");

      const loginResponsePromise = page
        .waitForResponse(
          (response) =>
            response.url().includes("/api/login") && response.request().method() === "POST",
          { timeout: 5_000 },
        )
        .catch(() => null);

      await page.getByTestId("login-submit").click();

      const loginResponse = await loginResponsePromise;
      if (!loginResponse) {
        if (attempt === 0) {
          continue;
        }
        throw new Error("Login request did not fire");
      }

      expect(loginResponse.ok()).toBe(false);
      break;
    }

    await expect(page.getByTestId("login-error")).toBeVisible();
  });

  test("login navigates to dashboard", async ({ page, testing }) => {
    await testing.login({ username: "test_loginflow", role: "admin" });
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("login-id").fill("test_loginflow");
    await page.getByTestId("login-password").fill("testpassword123");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("unauthenticated redirect preserves target url", async ({ page, testing }) => {
    await testing.login({ username: "test_redirect_after_login", role: "student" });
    await page.context().clearCookies();

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?redirect=%2Fsettings$/);

    await page.waitForLoadState("networkidle");
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
    await expect(page).toHaveURL(/\/login\?redirect=%2Fsettings$/);
    await expect(page.getByTestId("google-oauth")).toHaveAttribute(
      "href",
      "/api/oauth/google?redirect=%2Fsettings",
    );
    await expect(page.getByTestId("apple-oauth")).toHaveCount(0);
  });
});
