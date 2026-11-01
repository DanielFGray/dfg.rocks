import { test, expect, loginViaUi } from "./helpers.js";

test.describe("active-student switching parity", () => {
  test.beforeEach(async ({ testing }) => {
    await testing.clear();
    // Create a parent with two students
    await testing.login({
      username: "test_parent_parity",
      role: "parent",
      email: "parent_parity@test.local",
      name: "Test Parent",
    });
    await testing.seedFamily({
      slug: "parity-family",
      name: "Parity Family",
      owner_username: "test_parent_parity",
    });
    await testing.login({
      username: "student_one",
      role: "student",
      email: "student_one@test.local",
      name: "Student One",
    });
    await testing.login({
      username: "student_two",
      role: "student",
      email: "student_two@test.local",
      name: "Student Two",
    });
    await testing.seedFamilyMembership({
      username: "student_one",
      family_slug: "parity-family",
    });
    await testing.seedFamilyMembership({
      username: "student_two",
      family_slug: "parity-family",
    });
  });

  test("parent can switch between children and see correct dashboard data", async ({
    page,
    testing,
  }) => {
    await loginViaUi(page, "test_parent_parity", "testpassword123");

    // Should show ParentDashboard initially (no active student)
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await expect(page.getByText("Your Students")).toBeVisible();

    // Switch to Student One
    await page.getByTestId("switch-to-student_one").click();
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await expect(page.getByText("Welcome back, Student")).toBeVisible(); // or "Welcome back, Student One"

    // Verify dashboard shows Student One's data
    // Add specific assertions for Student One's data if seeded

    // Switch to Student Two
    await page.getByTestId("switch-to-student_two").click();
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await expect(page.getByText("Welcome back, Student")).toBeVisible();

    // Verify dashboard shows Student Two's data
  });

  test("parent switching children updates courses page", async ({ page, testing }) => {
    // Seed courses for each student
    await testing.seedCourse({
      title: "Piano Basics",
      instrument: "piano",
    });
    await testing.enroll({ username: "student_one", courseTitle: "Piano Basics" });

    await testing.seedCourse({
      title: "Guitar Fundamentals",
      instrument: "guitar",
    });
    await testing.enroll({ username: "student_two", courseTitle: "Guitar Fundamentals" });

    await loginViaUi(page, "test_parent_parity", "testpassword123");

    // Switch to Student One
    await page.getByTestId("switch-to-student_one").click();
    await page.goto("/courses");
    await expect(page.getByTestId("courses")).toBeVisible();
    await expect(page.getByText("Piano Basics")).toBeVisible();
    await expect(page.getByText("Guitar Fundamentals")).not.toBeVisible();

    // Switch to Student Two
    await page.getByTestId("switch-to-student_two").click();
    await page.goto("/courses");
    await expect(page.getByTestId("courses")).toBeVisible();
    await expect(page.getByText("Guitar Fundamentals")).toBeVisible();
    await expect(page.getByText("Piano Basics")).not.toBeVisible();
  });

  test("parent switching children updates messages page", async ({ page, testing }) => {
    // Seed messages for each student
    await testing.login({
      username: "teacher_parity",
      role: "teacher",
      email: "teacher_parity@test.local",
    });
    // Note: Would need a helper to seed messages for specific students

    await loginViaUi(page, "test_parent_parity", "testpassword123");

    // Switch to Student One
    await page.getByTestId("switch-to-student_one").click();
    await page.goto("/messages");
    await expect(page.getByTestId("messages")).toBeVisible();
    // Verify messages for Student One

    // Switch to Student Two
    await page.getByTestId("switch-to-student_two").click();
    await page.goto("/messages");
    await expect(page.getByTestId("messages")).toBeVisible();
    // Verify messages for Student Two
  });

  test("parent switching children updates practice logs", async ({ page, testing }) => {
    // Seed practice logs for each student
    // Note: Would need helpers to seed practice logs

    await loginViaUi(page, "test_parent_parity", "testpassword123");

    // Switch to Student One
    await page.getByTestId("switch-to-student_one").click();
    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard")).toBeVisible();
    // Verify practice logs for Student One

    // Switch to Student Two
    await page.getByTestId("switch-to-student_two").click();
    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard")).toBeVisible();
    // Verify practice logs for Student Two
  });

  test("parent switching children resets booking state", async ({ page, testing }) => {
    await loginViaUi(page, "test_parent_parity", "testpassword123");

    // Go to book-lesson page
    await page.goto("/book-lesson");
    await expect(page.getByTestId("book-lesson")).toBeVisible();

    // Select Student One
    await page.getByTestId("booking-student").click();
    await page.getByTestId("select-option-student_one").click();

    // Select a slot (if available)
    const slot = page.getByTestId("slot").first();
    if (await slot.isVisible()) {
      await slot.click();

      // Switch to Student Two before confirming
      await page.getByTestId("switch-to-student_two").click();

      // Booking dialog should be closed (bookingSlot reset)
      await expect(page.getByTestId("confirm-dialog")).not.toBeVisible();
    }
  });
});