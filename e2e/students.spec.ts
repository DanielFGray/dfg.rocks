import { test, expect, loginViaUi } from "./helpers.js";

test.describe("students management", () => {
  test("admin sees students page with roster", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_student1",
      role: "student",
      name: "Alice Student",
      email: "alice@test.local",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-people").click();
    await expect(page.getByTestId("people")).toBeVisible();
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
    await expect(page.getByText("Alice Student")).toBeVisible();
  });

  test("admin changes a person's role on the detail page", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_role_person",
      role: "student",
      name: "Dana Role",
      email: "dana.role@test.local",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-people").click();
    await page.getByText("Dana Role").click();
    await expect(page.getByTestId("person-detail")).toBeVisible();

    // Cancel leaves the role as it was.
    await page.getByTestId("person-role").click();
    await page.getByTestId("select-option-parent").click();
    const dialog = page.getByRole("alertdialog", { name: "Change role" });
    await expect(dialog).toContainText("Change Dana Role from Student to Parent?");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("person-role")).toContainText("Student");

    await page.getByTestId("person-role").click();
    await page.getByTestId("select-option-parent").click();
    await page
      .getByRole("alertdialog", { name: "Change role" })
      .getByRole("button", { name: "Confirm" })
      .click();
    await expect(page.getByTestId("person-role")).toContainText("Parent");
    // A parent is not a learner, so the learner sections leave the page.
    await expect(page.getByText("Enrolled Courses")).toHaveCount(0);
  });

  test("student name links to detail page", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_student2",
      role: "student",
      name: "Carol Musician",
      email: "carol@test.local",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-people").click();
    await page.getByRole("link", { name: "Carol Musician" }).click();

    await expect(page.getByTestId("person-detail")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Carol Musician" })).toBeVisible();
  });

  test("admin manages a monthly prepaid recurring schedule and payment", async ({
    page,
    testing,
  }) => {
    await testing.login();
    await testing.login({
      username: "test_recurring_student",
      role: "student",
      name: "Riley Recurring",
      email: "riley@test.local",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-people").click();
    await page.getByRole("link", { name: "Riley Recurring" }).click();
    await expect(page.getByTestId("student-recurring-billing")).toBeVisible();

    await page.getByTestId("add-student-rate").click();
    const rateForm = page.getByTestId("student-rate-form");
    await rateForm.getByLabel("Rate amount (USD)").fill("240");
    await rateForm.getByLabel("Lesson duration (minutes)").fill("60");
    await rateForm.getByTestId("rate-billing-model").click();
    await page.getByTestId("select-option-monthly_prepaid").click();
    await rateForm.getByRole("button", { name: "Save rate" }).click();

    const rateCard = page.getByTestId("student-rate-card");
    await expect(rateCard).toContainText("$240.00 / 60 min");
    await expect(rateCard).toContainText("Monthly prepaid");

    await rateCard.getByRole("button", { name: "Edit" }).click();
    await page.getByTestId("student-rate-form").getByLabel("Rate amount (USD)").fill("260");
    await page.getByTestId("student-rate-form").getByRole("button", { name: "Save rate" }).click();
    await expect(rateCard).toContainText("$260.00 / 60 min");

    await page.getByTestId("add-recurring-schedule").click();
    const scheduleForm = page.getByTestId("recurring-schedule-form");
    await scheduleForm.getByTestId("schedule-weekday").click();
    await page.getByTestId("select-option-3").click();
    await scheduleForm.getByTestId("schedule-local-time").fill("16:30");
    await scheduleForm.getByTestId("schedule-start-date").fill("2026-08-05");
    await scheduleForm.getByTestId("schedule-end-date").fill("2026-12-16");
    await scheduleForm.getByRole("button", { name: "Save schedule" }).click();

    const scheduleCard = page.getByTestId("recurring-schedule-card");
    await expect(scheduleCard).toContainText("Wednesday at 4:30 PM");
    await expect(scheduleCard).toContainText("America/Chicago");
    await expect(scheduleCard).toContainText("Active");

    await scheduleCard.getByRole("button", { name: "Edit" }).click();
    await page
      .getByTestId("recurring-schedule-form")
      .getByTestId("schedule-local-time")
      .fill("17:00");
    await page
      .getByTestId("recurring-schedule-form")
      .getByRole("button", { name: "Save schedule" })
      .click();
    await expect(scheduleCard).toContainText("Wednesday at 5:00 PM");

    await page.getByTestId("record-monthly-payment").click();
    const paymentForm = page.getByTestId("monthly-payment-form");
    await paymentForm.getByTestId("payment-billing-month").fill("2026-08");
    await paymentForm.getByTestId("payment-amount").fill("260");
    await paymentForm.getByTestId("payment-paid-at").fill("2026-07-20T10:30");
    await paymentForm.getByLabel("Notes").fill("Paid by check");
    await paymentForm.getByRole("button", { name: "Record payment" }).click();

    const paymentRow = page.getByTestId("monthly-payment-row");
    await expect(paymentRow).toContainText("Aug 1, 2026");
    await expect(paymentRow).toContainText("$260.00");
    await expect(paymentRow.getByTestId("payment-generation-status")).not.toBeEmpty();
  });
});
