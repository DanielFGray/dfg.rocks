import { test, expect, loginViaUi } from "./helpers.js";

// Each admin page's loader asks the server for admin data, which refuses anyone else. The page
// sends a non-admin to the dashboard first, so a direct load is a redirect, never a 500.
const adminPages = [
  "/billing",
  "/lessons",
  "/people",
  "/people/00000000-0000-0000-0000-000000000000",
  "/submissions",
];

test("a student who opens an admin page is sent to the dashboard", async ({ page, testing }) => {
  await testing.login({ username: "admin_page_student", role: "student" });
  await loginViaUi(page, "admin_page_student", "testpassword123");

  for (const path of adminPages) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBeLessThan(500);
    await expect(page, path).toHaveURL(/\/dashboard/);
  }
});
