import { test, expect, loginViaUi } from "./helpers.js";

test.describe("enrollment management", () => {
  test("course detail shows enrolled students section", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_enrolled",
      role: "student",
      name: "Enrolled Student",
    });
    await testing.seedCourse({
      title: "Test: Enrollment Course",
      instrument: "Guitar",
    });
    await testing.enroll("test_enrolled", "Test: Enrollment Course");

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-courses").click();
    await page.getByText("Test: Enrollment Course").click();

    await expect(page.getByRole("heading", { name: "Enrolled Students" })).toBeVisible();
    // The enrolled student's name appears as a link in the section
    await expect(page.getByRole("link", { name: "Enrolled Student" })).toBeVisible();
  });

  test("admin can enroll student from student detail", async ({ page, testing }) => {
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
    await page.getByTestId("nav-students").click();
    await page.getByText("Enroll Target").first().click();
    await expect(page.getByTestId("student-detail")).toBeVisible();

    // Should see empty enrolled courses
    await expect(page.getByText("Not enrolled in any courses")).toBeVisible();

    // Enroll the student — use the EmptyState action button
    const enrollAction = page.getByRole("button", { name: "Enroll in Course" });
    await expect(enrollAction).toBeVisible();
    await enrollAction.click();

    // Wait for the modal form to appear
    const enrollForm = page.getByTestId("enroll-form");
    await expect(enrollForm).toBeVisible({ timeout: 10_000 });
    await enrollForm.getByRole("button", { name: /Course/ }).click();
    const courseOpt = page.getByRole("option", { name: /Enroll Target Course/ });
    await expect(courseOpt).toBeVisible();
    await courseOpt.click();
    await enrollForm.getByRole("button", { name: "Enroll", exact: true }).click();

    // Should now see the course in the student detail section
    await expect(
      page.locator("main").getByText("Test: Enroll Target Course", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
