import { test, expect, loginViaUi } from "./helpers.js";

test.describe("admin course management", () => {
  test("admin can create a course", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-courses").click();

    await page.getByTestId("new-course").click();
    await expect(page.getByTestId("course-form")).toBeVisible();

    const form = page.getByTestId("course-form");
    await form.getByLabel("Title").fill("Test: Admin Created");
    await form.getByRole("button", { name: /Instrument/ }).click();
    await page.getByRole("option", { name: "Drums" }).click();
    await form.getByLabel("Description").fill("Created via admin UI");
    await page.getByTestId("course-submit").click();

    // Should refresh and show the new course
    await expect(page.getByText("Test: Admin Created")).toBeVisible();
  });

  test("admin sees edit/delete buttons on course cards", async ({ page, testing }) => {
    await testing.login();
    await testing.seedCourse({
      title: "Test: With Buttons",
      instrument: "Guitar",
    });
    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-courses").click();

    await expect(page.getByRole("button", { name: "Edit" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" }).first()).toBeVisible();
  });
});
