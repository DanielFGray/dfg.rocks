import { test, expect, getPw, loginViaUi } from "./helpers.js";

test.describe("admin course management", () => {
  test("admin sees New Course button", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await expect(getPw(page, "new-course")).toBeVisible();
  });

  test("admin can create a course", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");

    await getPw(page, "new-course").click();
    await expect(getPw(page, "course-form")).toBeVisible();

    await page.locator("#course-title").fill("Test: Admin Created");
    await page.locator("#course-instrument").selectOption("Drums");
    await page.locator("#course-description").fill("Created via admin UI");
    await page.locator('[data-pwid="course-form"] button[type="submit"]').click();

    // Should refresh and show the new course
    await expect(page.getByText("Test: Admin Created")).toBeVisible();
  });

  test("admin sees edit/delete buttons on course cards", async ({ page, testing }) => {
    await testing.login();
    await testing.seedCourse({ title: "Test: With Buttons", instrument: "Guitar" });
    await loginViaUi(page, "test_admin", "testpassword123");

    await expect(page.getByRole("button", { name: "Edit" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" }).first()).toBeVisible();
  });
});
