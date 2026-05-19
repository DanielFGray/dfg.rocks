import path from "node:path";
import { test, expect, loginViaUi } from "./helpers.js";

const notationFixturePath = path.join(
  process.cwd(),
  "uploads",
  "20434311-ceb3-43ba-a489-aa83ac477167.gp5",
);

test.describe("assignments management", () => {
  test("admin can assign a material from the assignments page", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_assignment_student_admin",
      role: "student",
      name: "Admin Assignment Student",
    });
    await testing.seedMaterial({
      title: "Test Assignment Material Admin",
      original_filename: "admin-assignment.gp5",
      mime_type: "application/octet-stream",
      source_file_path: notationFixturePath,
      is_global: false,
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-assignments").click();

    await expect(page.getByRole("heading", { name: "Assignments" })).toBeVisible();

    const studentCard = page
      .getByTestId("assignment-student-card")
      .filter({ hasText: "Admin Assignment Student" });
    await expect(studentCard).toBeVisible();

    await studentCard.getByRole("button", { name: /\+ Assign/ }).click();

    const form = page.getByTestId("staff-assign-form");
    await expect(form).toBeVisible();
    await form.locator("#staff-assign-material").click();
    await page
      .getByRole("option", { name: /Test Assignment Material Admin/ })
      .first()
      .click();
    await form.locator("#staff-assign-track").click();
    await page.getByRole("option", { name: "Bass" }).click();
    await form.locator('button[type="submit"]').click();

    await expect(studentCard.getByText("Test Assignment Material Admin")).toBeVisible({
      timeout: 10_000,
    });
    await expect(studentCard.getByText("Playback 0m 00s")).toBeVisible();
    await expect(studentCard.getByText("Bass")).toBeVisible();
  });

  test("teacher sees staff assignment UI and can assign a material", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_assignment_teacher",
      role: "teacher",
      name: "Teacher User",
    });
    await testing.login({
      username: "test_assignment_student_teacher",
      role: "student",
      name: "Teacher Assignment Student",
    });
    await testing.seedMaterial({
      title: "Test Assignment Material Teacher",
      original_filename: "teacher-assignment.pdf",
      is_global: false,
    });

    await loginViaUi(page, "test_assignment_teacher", "testpassword123");
    await page.getByTestId("nav-assignments").click();

    await expect(page.getByRole("heading", { name: "Assignments" })).toBeVisible();

    const studentCard = page
      .getByTestId("assignment-student-card")
      .filter({ hasText: "Teacher Assignment Student" });
    await expect(studentCard).toBeVisible();

    await studentCard.getByRole("button", { name: /\+ Assign/ }).click();

    const form = page.getByTestId("staff-assign-form");
    await expect(form).toBeVisible();
    await form.locator("#staff-assign-material").click();
    await page
      .getByRole("option", { name: /Test Assignment Material Teacher/ })
      .first()
      .click();
    await form.locator('button[type="submit"]').click();

    await expect(studentCard.getByText("Test Assignment Material Teacher")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("student uses self-reviews instead of manual practice buttons", async ({
    page,
    testing,
  }) => {
    await testing.login();
    await testing.login({
      username: "test_assignment_student_progress",
      role: "student",
      name: "Progress Student",
    });
    await testing.seedMaterial({
      title: "Test: Student Review Material",
      original_filename: "student-review.gp5",
      mime_type: "application/octet-stream",
      source_file_path: notationFixturePath,
      is_global: false,
    });
    await testing.assignMaterial(
      "test_assignment_student_progress",
      "Test: Student Review Material",
      2,
    );

    await loginViaUi(page, "test_assignment_student_progress", "testpassword123");
    await page.getByTestId("nav-assignments").click();

    await expect(page.getByRole("button", { name: "Practiced" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark Complete" })).toHaveCount(0);

    const materialCard = page
      .getByTestId("assignment-material-card")
      .filter({ hasText: "Test: Student Review Material" });
    await expect(materialCard).toBeVisible();
    await expect(materialCard.getByText("Bass")).toBeVisible();
    await page
      .getByTestId("assignment-open-link")
      .filter({ hasText: "Test: Student Review Material" })
      .click();
    await expect(page.getByTestId("assignment-detail")).toBeVisible();
    await expect(page.getByText("student-review.gp5 · Bass")).toBeVisible();
    await expect(page.getByLabel("Track:")).toHaveValue("2", { timeout: 15_000 });

    await expect(page.getByText("No self-reviews yet.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save Review" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Rate 4 out of 5" })).toHaveCount(0);
  });
});
