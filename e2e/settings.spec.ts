import { test, expect, loginViaUi } from "./helpers.js";

test.describe("settings page", () => {
  test("displays primary email with badges", async ({ page, testing }) => {
    await testing.login({
      username: "test_settings",
      email: "settings@test.local",
    });
    await loginViaUi(page, "test_settings", "testpassword123");
    await page.getByTestId("nav-settings").click();
    await expect(page.getByTestId("settings")).toBeVisible();
    await expect(page.getByText("settings@test.local")).toBeVisible();
    await expect(page.getByText("Primary")).toBeVisible();
    await expect(page.getByText("Verified")).toBeVisible();
  });

  test("primary email has no Remove button", async ({ page, testing }) => {
    await testing.login({
      username: "test_no_remove",
      email: "only@test.local",
    });
    await loginViaUi(page, "test_no_remove", "testpassword123");
    await page.getByTestId("nav-settings").click();
    await expect(page.getByText("only@test.local")).toBeVisible();
    await expect(page.getByTestId("remove-email")).toHaveCount(0);
  });

  test("can add a new email address", async ({ page, testing }) => {
    await testing.login({
      username: "test_add_email",
      email: "primary@test.local",
    });
    await loginViaUi(page, "test_add_email", "testpassword123");
    await page.getByTestId("nav-settings").click();

    await page.getByTestId("new-email-input").fill("secondary@test.local");
    await page.getByTestId("add-email-btn").click();

    await expect(page.getByText("secondary@test.local")).toBeVisible();
    await expect(page.getByText("Unverified")).toBeVisible();
  });

  test("added email shows resend verification button", async ({ page, testing }) => {
    await testing.login({
      username: "test_resend",
      email: "main@test.local",
    });
    await loginViaUi(page, "test_resend", "testpassword123");
    await page.getByTestId("nav-settings").click();

    await page.getByTestId("new-email-input").fill("extra@test.local");
    await page.getByTestId("add-email-btn").click();

    await expect(page.getByText("extra@test.local")).toBeVisible();
    await expect(page.getByTestId("resend-verification")).toBeVisible();
  });

  test("can remove a non-primary email", async ({ page, testing }) => {
    await testing.login({
      username: "test_remove",
      email: "keep@test.local",
    });
    await loginViaUi(page, "test_remove", "testpassword123");
    await page.getByTestId("nav-settings").click();

    // Add a second email so we have something to remove
    await page.getByTestId("new-email-input").fill("discard@test.local");
    await page.getByTestId("add-email-btn").click();
    await expect(page.getByText("discard@test.local")).toBeVisible();

    // Click Remove
    await page.getByTestId("remove-email").click();

    const confirmDialog = page.getByRole("alertdialog", { name: "Remove Email" });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Remove" }).click();

    // Email should be gone
    await expect(page.getByText("discard@test.local", { exact: true })).not.toBeVisible();
  });

  test("cancel on remove dialog keeps the email", async ({ page, testing }) => {
    await testing.login({
      username: "test_cancel_remove",
      email: "stay@test.local",
    });
    await loginViaUi(page, "test_cancel_remove", "testpassword123");
    await page.getByTestId("nav-settings").click();

    await page.getByTestId("new-email-input").fill("maybe@test.local");
    await page.getByTestId("add-email-btn").click();
    await expect(page.getByText("maybe@test.local")).toBeVisible();

    // Open remove dialog then cancel
    await page.getByTestId("remove-email").click();
    const confirmDialog = page.getByRole("alertdialog", { name: "Remove Email" });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Cancel" }).click();

    // Email still present
    await expect(page.getByText("maybe@test.local", { exact: true })).toBeVisible();
  });

  test("settings link visible for student role", async ({ page, testing }) => {
    await testing.login({
      username: "test_student_nav",
      role: "student",
    });
    await loginViaUi(page, "test_student_nav", "testpassword123");
    await expect(page.getByTestId("nav-settings")).toBeVisible();
  });
});
