import { test, expect, getPw, loginViaUi } from "./helpers.js";

test.describe("enrollment management", () => {
  test("course detail shows enrolled students section", async ({
    page,
    testing,
  }) => {
    await testing.login();
    const student = await testing.login({
      username: "test_enrolled",
      role: "student",
      name: "Enrolled Student",
    });
    const course = await testing.seedCourse({
      title: "Test: Enrollment Course",
      instrument: "Guitar",
    });
    await testing.enroll(student.id, course.id);

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByText("Test: Enrollment Course").click();

    await expect(
      page.getByRole("heading", { name: "Enrolled Students" }),
    ).toBeVisible();
    // The enrolled student's name appears as a link in the section
    await expect(
      page.getByRole("link", { name: "Enrolled Student" }),
    ).toBeVisible();
  });

  test("admin can enroll student from student detail", async ({
    page,
    testing,
  }) => {
    await testing.login();
    await testing.login({
      username: "test_enroll_target",
      role: "student",
      name: "Enroll Target",
    });
    await testing.seedCourse({
      title: "Test: Enroll Target Course",
      instrument: "Piano",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await getPw(page, "nav-students").click();
    await page.getByText("Enroll Target").first().click();
    await expect(getPw(page, "student-detail")).toBeVisible();

    // Should see empty enrolled courses
    await expect(page.getByText("Not enrolled in any courses")).toBeVisible();

    // Enroll the student — use the EmptyState action button
    const enrollAction = page.getByRole("button", { name: "Enroll in Course" });
    await expect(enrollAction).toBeVisible();
    await enrollAction.click();

    // Wait for the modal form to appear
    const enrollForm = getPw(page, "enroll-form");
    await expect(enrollForm).toBeVisible({ timeout: 10_000 });
    await enrollForm
      .locator('select[name="course_id"]')
      .selectOption({ label: "Test: Enroll Target Course (Piano)" });
    await enrollForm.locator('button[type="submit"]').click();

    // Should now see the course
    await expect(
      page.getByText("Test: Enroll Target Course"),
    ).toBeVisible({ timeout: 10_000 });
  });
});
