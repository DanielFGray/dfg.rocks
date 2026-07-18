import path from "node:path";
import { test, expect, loginViaUi } from "./helpers.js";

const notationFixturePath = path.join(process.cwd(), "e2e", "fixtures", "fixture-score.musicxml");

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
      original_filename: "admin-assignment.musicxml",
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
    await form.getByRole("combobox", { name: "Material" }).click();
    await page
      .getByRole("option", { name: /Test Assignment Material Admin/ })
      .first()
      .click();
    await form.getByRole("combobox", { name: "Assigned Track" }).click();
    await page.getByRole("option", { name: "Bass" }).click();
    await form.getByRole("button", { name: "Assign", exact: true }).click();

    await expect(studentCard.getByText("Test Assignment Material Admin")).toBeVisible({
      timeout: 10_000,
    });
    await expect(studentCard.getByText("Playback 0m 00s")).toBeVisible();
    await expect(studentCard.getByText("Bass")).toBeVisible();
  });

  test("student assignments refresh in realtime after an admin assignment", async ({
    browser,
    testing,
  }) => {
    await testing.login();
    await testing.login({
      username: "test_assignment_student_realtime",
      role: "student",
      name: "Realtime Assignment Student",
    });
    await testing.seedMaterial({
      title: "Realtime Assignment Material",
      original_filename: "realtime-assignment.pdf",
      is_global: false,
    });

    const studentContext = await browser.newContext();
    const adminContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    const adminPage = await adminContext.newPage();

    try {
      await loginViaUi(studentPage, "test_assignment_student_realtime", "testpassword123");
      await studentPage.getByTestId("nav-assignments").click();
      await expect(studentPage.getByRole("heading", { name: "My Assignments" })).toBeVisible();
      await expect(
        studentPage.getByText("No assignments yet. Your teacher will assign materials here."),
      ).toBeVisible();

      await loginViaUi(adminPage, "test_admin", "testpassword123");
      await adminPage.getByTestId("nav-assignments").click();

      const studentCard = adminPage
        .getByTestId("assignment-student-card")
        .filter({ hasText: "Realtime Assignment Student" });
      await expect(studentCard).toBeVisible();

      await studentCard.getByRole("button", { name: /\+ Assign/ }).click();

      const form = adminPage.getByTestId("staff-assign-form");
      await expect(form).toBeVisible();
      await form.getByRole("combobox", { name: "Material" }).click();
      await adminPage
        .getByRole("option", { name: /Realtime Assignment Material/ })
        .first()
        .click();
      await form.getByRole("button", { name: "Assign" }).click();

      await expect(studentCard.getByText("Realtime Assignment Material")).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        studentPage
          .getByTestId("assignment-material-card")
          .filter({ hasText: "Realtime Assignment Material" }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await Promise.all([studentContext.close(), adminContext.close()]);
    }
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
    await form.getByRole("combobox", { name: "Material" }).click();
    await page
      .getByRole("option", { name: /Test Assignment Material Teacher/ })
      .first()
      .click();
    await form.getByRole("button", { name: "Assign" }).click();

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
      original_filename: "student-review.musicxml",
      mime_type: "application/octet-stream",
      source_file_path: notationFixturePath,
      is_global: false,
    });
    await testing.assignMaterial(
      "test_assignment_student_progress",
      "Test: Student Review Material",
      1,
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
    await expect(page.getByText("student-review.musicxml · Bass")).toBeVisible();
    await expect(page.getByLabel("Track:")).toHaveValue("1", { timeout: 15_000 });

    await expect(page.getByText("No self-reviews yet.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save Review" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Rate 4 out of 5" })).toHaveCount(0);
  });
});
