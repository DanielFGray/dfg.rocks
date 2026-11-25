import { test, expect, loginViaUi } from "./helpers.js";
import type { Route } from "@playwright/test";

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

  test.describe("escape while a create is pending", () => {
    test("does not close the course modal", async ({ page, testing }) => {
      await testing.login();
      await loginViaUi(page, "test_admin", "testpassword123");
      await page.getByTestId("nav-courses").click();

      // Hold the create request in flight, so the submit can be observed pending.
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/admin/courses", (route: Route) => {
        if (route.request().method() !== "POST") return route.continue();
        return gate.then(() => route.continue());
      });

      await page.getByTestId("new-course").click();
      const form = page.getByTestId("course-form");
      await form.getByLabel("Title").fill("Test: Escape Held");
      await form.getByRole("button", { name: /Instrument/ }).click();
      await page.getByRole("option", { name: "Drums" }).click();
      await page.getByTestId("course-submit").click();

      // The submit is in flight: the control is disabled, and Escape (with
      // focus inside the dialog, as a user has it) does not close the modal.
      await expect(page.getByTestId("course-submit")).toBeDisabled();
      await form.getByLabel("Title").click();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("course-form")).toBeVisible();

      release();
      await expect(page.getByText("Test: Escape Held")).toBeVisible();
      await expect(page.getByTestId("course-form")).toHaveCount(0);
    });
  });
});
