import { test, expect, getPw, loginViaUi } from "./helpers.js";

test.describe("dashboard", () => {
  test("shows courses after login", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await expect(getPw(page, "dashboard")).toBeVisible();
  });

  test.skip("survives page refresh", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await expect(getPw(page, "dashboard")).toBeVisible();

    // Hard refresh — client re-renders after SSR shell
    await page.reload({ waitUntil: "networkidle" });
    await expect(getPw(page, "dashboard")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Courses" }),
    ).toBeVisible();
  });
});
