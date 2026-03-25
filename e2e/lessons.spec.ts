import { test, expect, getPw, loginViaUi } from "./helpers.js";

test.describe("lesson management", () => {
  test("admin sees lessons page with scheduled lessons", async ({ page, testing }) => {
    await testing.login();
    const student = await testing.login({
      username: "test_lesson_student",
      role: "student",
      name: "Lesson Student",
    });
    await testing.seedLesson({ student_id: student.id });

    await loginViaUi(page, "test_admin", "testpassword123");
    await getPw(page, "nav-lessons").click();
    await expect(getPw(page, "lessons")).toBeVisible();
    await expect(page.getByText("Lesson Student")).toBeVisible();
    await expect(page.getByText("Scheduled")).toBeVisible();
  });

  test("admin can create a new lesson", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_new_lesson",
      role: "student",
      name: "New Lesson Student",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await getPw(page, "nav-lessons").click();
    await getPw(page, "new-lesson").click();

    // Fill the form
    await page.locator("#lesson-student").selectOption({ label: "New Lesson Student" });
    await page.locator("#lesson-scheduled-at").fill("2026-04-01T10:00");
    await page.locator("#lesson-duration").selectOption("60");
    await page.locator("#lesson-location").selectOption("online");
    await page.locator('[data-pwid="lesson-form"] button[type="submit"]').click();

    // Should see the new lesson
    await expect(page.getByText("New Lesson Student")).toBeVisible();
  });

  test("admin can mark a lesson as completed", async ({ page, testing }) => {
    await testing.login();
    const student = await testing.login({
      username: "test_complete",
      role: "student",
      name: "Complete Student",
    });
    await testing.seedLesson({ student_id: student.id });

    await loginViaUi(page, "test_admin", "testpassword123");
    await getPw(page, "nav-lessons").click();
    await getPw(page, "complete-lesson").first().click();
    await expect(page.getByText("Completed")).toBeVisible();
  });

  test("admin can cancel a lesson", async ({ page, testing }) => {
    await testing.login();
    const student = await testing.login({
      username: "test_cancel",
      role: "student",
      name: "Cancel Student",
    });
    await testing.seedLesson({ student_id: student.id });

    await loginViaUi(page, "test_admin", "testpassword123");
    await getPw(page, "nav-lessons").click();
    await getPw(page, "cancel-lesson").first().click();
    // Confirm dialog should appear
    await page.getByRole("button", { name: "Cancel Lesson" }).last().click();
    await expect(page.getByText("Cancelled")).toBeVisible();
  });

  test("admin can add notes to a lesson and publish", async ({ page, testing }) => {
    await testing.login();
    const student = await testing.login({
      username: "test_notes",
      role: "student",
      name: "Notes Student",
    });
    await testing.seedLesson({ student_id: student.id, status: "completed" });

    await loginViaUi(page, "test_admin", "testpassword123");
    await getPw(page, "nav-lessons").click();

    // Click Notes button on the lesson
    await getPw(page, "lesson-notes").first().click();

    // Fill note fields
    await page.locator("#note-topics").fill("Worked on rudiments");
    await page.locator("#note-homework").fill("Practice paradiddles 10 min daily");
    await page.locator("#note-progress").fill("Great rhythm, needs work on dynamics");

    // Publish the note
    await getPw(page, "publish-note").click();

    // Modal should close, back to lessons list
    await expect(getPw(page, "lessons")).toBeVisible();
  });
});
