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
      visibility: "course",
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
      visibility: "course",
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
      visibility: "course",
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

  // Regression: the production bundle once inlined alphaTab's audio worklet as a data: URL,
  // which cannot import alphaTab's core, so Play made no sound and the clock never moved.
  test("student plays an assigned score", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_assignment_student_playback",
      role: "student",
      name: "Playback Student",
    });
    await testing.seedMaterial({
      title: "Test: Playback Material",
      original_filename: "playback.musicxml",
      mime_type: "application/octet-stream",
      source_file_path: notationFixturePath,
      visibility: "course",
    });
    await testing.assignMaterial("test_assignment_student_playback", "Test: Playback Material", 1);

    await loginViaUi(page, "test_assignment_student_playback", "testpassword123");
    await page.getByTestId("nav-assignments").click();
    await page
      .getByTestId("assignment-open-link")
      .filter({ hasText: "Test: Playback Material" })
      .click();

    // The end time appears once the score is loaded and its MIDI generated.
    const time = page.getByTestId("alphatab-time");
    await expect(time).not.toHaveText(/ \/ 0:00$/, { timeout: 15_000 });
    await page.getByRole("button", { name: "Play" }).click();
    await expect(time).not.toHaveText(/^0:00 /, { timeout: 10_000 });
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
      visibility: "course",
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
    await expect(page.getByRole("combobox", { name: "Track" })).toHaveValue("1", {
      timeout: 15_000,
    });

    await expect(page.getByText("No self-reviews yet.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save Review" })).toHaveCount(0);
    // The only rating group left is the Self-Assessment one; the review group (paired with
    // "Save Review") stays hidden until the student has listened through the piece.
    await expect(page.getByRole("button", { name: "Rate 4 out of 5" })).toHaveCount(1);
  });

  test("notation assignment shows the server-drawn score until the player draws, and in print", async ({
    page,
    testing,
  }) => {
    await testing.login();
    await testing.login({
      username: "test_assignment_student_static",
      role: "student",
      name: "Static Score Student",
    });
    await testing.seedMaterial({
      title: "Test: Static Score Material",
      original_filename: "static-score.musicxml",
      mime_type: "application/octet-stream",
      source_file_path: notationFixturePath,
      visibility: "course",
    });
    await testing.assignMaterial(
      "test_assignment_student_static",
      "Test: Static Score Material",
      0,
    );

    await loginViaUi(page, "test_assignment_student_static", "testpassword123");
    await page.getByTestId("nav-assignments").click();
    await page
      .getByTestId("assignment-open-link")
      .filter({ hasText: "Test: Static Score Material" })
      .click();
    await expect(page.getByTestId("assignment-detail")).toBeVisible();

    // The swap must not show an empty player: record what the player holds at
    // the moment it is marked ready.
    await page.addInitScript(() => {
      new MutationObserver((records) => {
        const ready = records.find((r) => (r.target as Element).hasAttribute("data-player-ready"));
        if (ready) {
          const drawn = (ready.target as Element).querySelectorAll(".at-frame-player svg").length;
          document.documentElement.dataset.playerSvgsAtSwap = String(drawn);
        }
      }).observe(document, { subtree: true, attributeFilter: ["data-player-ready"] });
    });
    // While the score file downloads, the player cannot draw, so the static
    // score shows.
    let releaseScoreFile = () => {};
    const scoreFileReleased = new Promise<void>((resolve) => {
      releaseScoreFile = resolve;
    });
    await page.route("**/api/materials/*/download", async (route) => {
      await scoreFileReleased;
      await route.continue();
    });
    await page.reload();
    await expect(page.locator(".at-frame-static svg.at-static-part").first()).toBeVisible();
    await expect(page.locator(".at-frame[data-player-ready]")).toHaveCount(0);

    releaseScoreFile();
    await expect(page.locator(".at-frame[data-player-ready]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".at-frame-static")).toBeHidden();
    await expect(page.locator("html")).not.toHaveAttribute("data-player-svgs-at-swap", "0");
    await expect(page.locator("html")).toHaveAttribute("data-player-svgs-at-swap", /^\d+$/);

    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".at-frame-static svg.at-static-part").first()).toBeVisible();
    await expect(page.locator(".at-frame-player")).toBeHidden();
  });
});
