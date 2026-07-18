import { test, expect, loginViaUi } from "./helpers.js";

test.describe("lesson management", () => {
  test("admin sees lessons page with scheduled lessons", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_lesson_student",
      role: "student",
      name: "Lesson Student",
    });
    await testing.seedLesson({ username: "test_lesson_student" });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-lessons").click();
    await expect(page.getByTestId("lessons")).toBeVisible();
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
    await page.getByTestId("nav-lessons").click();
    await page.getByTestId("new-lesson").click();

    // Fill the form — React Aria Selects need explicit waits for popover rendering
    const lessonForm = page.getByTestId("lesson-form");
    await lessonForm.getByRole("button", { name: /Student/ }).click();
    const studentOpt = page.getByRole("option", { name: "New Lesson Student" });
    await expect(studentOpt).toBeVisible();
    await studentOpt.click();

    const dateGroup = page.getByRole("group", { name: "Date" });
    await dateGroup.getByRole("spinbutton").nth(0).click();
    await page.keyboard.type("4");
    await page.keyboard.type("1");
    await page.keyboard.type("2026");
    const timeGroup = page.getByRole("group", { name: "Time" });
    await timeGroup.getByRole("spinbutton").nth(0).click();
    await page.keyboard.type("10");
    await page.keyboard.type("00");

    await lessonForm.getByRole("button", { name: /Duration/ }).click();
    const durationOpt = page.getByRole("option", { name: "60 minutes" });
    await expect(durationOpt).toBeVisible();
    await durationOpt.click();

    await lessonForm.getByRole("button", { name: /Location/ }).click();
    const locationOpt = page.getByRole("option", { name: "Online" });
    await expect(locationOpt).toBeVisible();
    await locationOpt.click();

    await page.getByTestId("lesson-submit").click();

    // Should see the new lesson in the list
    await expect(page.getByTestId("lessons")).toBeVisible();
    await expect(page.locator("main").getByText("New Lesson Student")).toBeVisible();
  });

  test("admin can mark a lesson as completed", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_complete",
      role: "student",
      name: "Complete Student",
    });
    await testing.seedLesson({ username: "test_complete" });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-lessons").click();
    await page.getByTestId("complete-lesson").first().click();
    await expect(page.getByText("Completed")).toBeVisible();
  });

  test("admin can cancel a lesson", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_cancel",
      role: "student",
      name: "Cancel Student",
    });
    await testing.seedLesson({ username: "test_cancel" });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-lessons").click();
    await page.getByTestId("cancel-lesson").first().click();
    const confirmDialog = page.getByRole("alertdialog", { name: "Cancel Lesson" });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Cancel Lesson" }).click();
    await expect(page.getByText("Cancelled")).toBeVisible();
  });

  test("admin can add notes to a lesson and publish", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_notes",
      role: "student",
      name: "Notes Student",
    });
    await testing.seedLesson({ username: "test_notes", status: "completed" });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-lessons").click();

    // Click Notes button on the lesson
    await page.getByTestId("lesson-notes").first().click();

    // Fill note fields
    const noteEditor = page.getByTestId("note-editor");
    await noteEditor.getByLabel("Topics Covered").fill("Worked on rudiments");
    await noteEditor.getByLabel("Homework").fill("Practice paradiddles 10 min daily");
    await noteEditor
      .getByLabel("Progress Observations")
      .fill("Great rhythm, needs work on dynamics");

    // Publish the note
    await page.getByTestId("publish-note").click();

    // Modal should close, back to lessons list
    await expect(page.getByTestId("lessons")).toBeVisible();
  });
});
