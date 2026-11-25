import { test, expect, loginViaUi, logoutViaUi } from "./helpers.js";

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
    await expect(page.getByTestId("primary-badge").first()).toBeVisible();
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

  test.describe("a create the server refuses", () => {
    test.use({ expectRefusedApi: ["/api/me/emails"] });

    test("add-email failure keeps the input and shows the server's message", async ({
      page,
      testing,
    }) => {
      await testing.login({
        username: "test_dup_email",
        email: "dup@test.local",
      });
      await loginViaUi(page, "test_dup_email", "testpassword123");
      await page.getByTestId("nav-settings").click();

      // The account already owns this address, so the server refuses the add.
      await page.getByTestId("new-email-input").fill("dup@test.local");
      await page.getByTestId("add-email-btn").click();

      await expect(page.getByTestId("new-email-input")).toHaveValue("dup@test.local");
      await expect(page.getByTestId("add-email-form").getByText(/already/)).toBeVisible();
      await expect(page.getByText("dup@test.local")).toHaveCount(1);
    });
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

  test("testimonials stay hidden until an admin approves them", async ({ page, testing }) => {
    const body =
      "Lessons have been organized, encouraging, and much easier to stay consistent with every week.";

    await testing.login({
      username: "test_pending_testimonial",
      role: "student",
      name: "Pending Student",
    });
    await loginViaUi(page, "test_pending_testimonial", "testpassword123");
    await page.getByTestId("nav-settings").click();

    await page.getByTestId("testimonial-textarea").fill(body);
    await page.getByTestId("save-testimonial").click();
    await expect(page.getByText("Pending admin approval")).toBeVisible();

    await logoutViaUi(page);
    await page.goto("/");
    await expect(page.getByText(body)).toHaveCount(0);

    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-settings").click();
    await expect(page.getByTestId("testimonial-review-section")).toBeVisible();
    await expect(page.getByText(body)).toBeVisible();
    await page.getByRole("button", { name: "Approve for site" }).click();
    await expect(page.getByText("Approved")).toBeVisible();

    await logoutViaUi(page);
    await page.goto("/");
    await expect(page.getByText(body)).toBeVisible();
  });
});
