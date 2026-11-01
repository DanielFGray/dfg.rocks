import { test, expect, loginViaUi } from "./helpers.js";

test.describe("active-student switching parity", () => {
  let studentOneId: string;
  let studentTwoId: string;

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
    await testing.seedFamilyMembership({
      username: "student_one",
      family_slug: "parity-family",
    });

    await testing.login({
      username: "student_two",
      role: "student",
      email: "student_two@test.local",
      name: "Student Two",
    });
    await testing.seedFamilyMembership({
      username: "student_two",
      family_slug: "parity-family",
    });
  });

  test("parent can switch between children and see correct dashboard data", async ({ page }) => {
    // First, get the student IDs by creating them via API
    await loginViaUi(page, "test_parent_parity", "testpassword123");

    // Create student one via API
    const createOneRes = await page.request.post(new URL("/api/create-child", page.url()).toString(), {
      data: { name: "Student One" },
      headers: { "Content-Type": "application/json", "X-Requested-With": "dfg" },
    });
    expect(createOneRes.status()).toBe(200);
    const studentOne = await createOneRes.json();
    studentOneId = studentOne.id;

    // Create student two via API
    const createTwoRes = await page.request.post(new URL("/api/create-child", page.url()).toString(), {
      data: { name: "Student Two" },
      headers: { "Content-Type": "application/json", "X-Requested-With": "dfg" },
    });
    expect(createTwoRes.status()).toBe(200);
    const studentTwo = await createTwoRes.json();
    studentTwoId = studentTwo.id;

    // Reload to see the students
    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard")).toBeVisible();

    // Should show ParentDashboard initially (no active student)
    await expect(page.getByText("Your Students")).toBeVisible();
    await expect(page.getByTestId(`student-card-${studentOneId}`)).toBeVisible();
    await expect(page.getByTestId(`student-card-${studentTwoId}`)).toBeVisible();

    // Switch to Student One
    await page.getByTestId(`switch-to-${studentOneId}`).click();
    await expect(page.getByTestId("dashboard")).toBeVisible();
    // Dashboard should now show Student One's view
    await expect(page.getByText("Welcome back, Student")).toBeVisible();

    // Verify dashboard shows Student One's data (no lessons, no messages initially)
    await expect(page.getByText("No upcoming lessons")).toBeVisible();

    // Switch to Student Two
    await page.getByTestId(`switch-to-${studentTwoId}`).click();
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await expect(page.getByText("Welcome back, Student")).toBeVisible();
    await expect(page.getByText("No upcoming lessons")).toBeVisible();
  });

  test("parent switching children updates courses page", async ({ page, testing }) => {
    await loginViaUi(page, "test_parent_parity", "testpassword123");

    // Create students if not already created
    if (!studentOneId) {
      const createOneRes = await page.request.post(new URL("/api/create-child", page.url()).toString(), {
        data: { name: "Student One" },
        headers: { "Content-Type": "application/json", "X-Requested-With": "dfg" },
      });
      expect(createOneRes.status()).toBe(200);
      const studentOne = await createOneRes.json();
      studentOneId = studentOne.id;

      const createTwoRes = await page.request.post(new URL("/api/create-child", page.url()).toString(), {
        data: { name: "Student Two" },
        headers: { "Content-Type": "application/json", "X-Requested-With": "dfg" },
      });
      expect(createTwoRes.status()).toBe(200);
      const studentTwo = await createTwoRes.json();
      studentTwoId = studentTwo.id;
    }

    // Seed courses for each student
    await testing.seedCourse({
      title: "Piano Basics",
      instrument: "piano",
    });
    await testing.enroll("student_one", "Piano Basics");

    await testing.seedCourse({
      title: "Guitar Fundamentals",
      instrument: "guitar",
    });
    await testing.enroll("student_two", "Guitar Fundamentals");

    // Switch to Student One
    await page.getByTestId(`switch-to-${studentOneId}`).click();
    await page.goto("/courses");
    await expect(page.getByTestId("courses")).toBeVisible();
    await expect(page.getByText("Piano Basics")).toBeVisible();
    await expect(page.getByText("Guitar Fundamentals")).not.toBeVisible();

    // Switch to Student Two
    await page.getByTestId(`switch-to-${studentTwoId}`).click();
    await page.goto("/courses");
    await expect(page.getByTestId("courses")).toBeVisible();
    await expect(page.getByText("Guitar Fundamentals")).toBeVisible();
    await expect(page.getByText("Piano Basics")).not.toBeVisible();
  });

  test("parent switching children updates messages page", async ({ page, testing }) => {
    await loginViaUi(page, "test_parent_parity", "testpassword123");

    // Create students if not already created
    if (!studentOneId) {
      const createOneRes = await page.request.post(new URL("/api/create-child", page.url()).toString(), {
        data: { name: "Student One" },
        headers: { "Content-Type": "application/json", "X-Requested-With": "dfg" },
      });
      expect(createOneRes.status()).toBe(200);
      const studentOne = await createOneRes.json();
      studentOneId = studentOne.id;

      const createTwoRes = await page.request.post(new URL("/api/create-child", page.url()).toString(), {
        data: { name: "Student Two" },
        headers: { "Content-Type": "application/json", "X-Requested-With": "dfg" },
      });
      expect(createTwoRes.status()).toBe(200);
      const studentTwo = await createTwoRes.json();
      studentTwoId = studentTwo.id;
    }

    // Login as teacher and send messages to each student
    await testing.login({
      username: "teacher_parity",
      role: "teacher",
      email: "teacher_parity@test.local",
    });

    // Note: Would need a helper to send messages to specific students
    // For now, just verify the page loads and switches

    await loginViaUi(page, "test_parent_parity", "testpassword123");

    // Switch to Student One
    await page.getByTestId(`switch-to-${studentOneId}`).click();
    await page.goto("/messages");
    await expect(page.getByTestId("messages")).toBeVisible();
    // Verify messages page loads for Student One

    // Switch to Student Two
    await page.getByTestId(`switch-to-${studentTwoId}`).click();
    await page.goto("/messages");
    await expect(page.getByTestId("messages")).toBeVisible();
    // Verify messages page loads for Student Two
  });

  test("parent switching children resets booking state", async ({ page }) => {
    await loginViaUi(page, "test_parent_parity", "testpassword123");

    // Create students if not already created
    if (!studentOneId) {
      const createOneRes = await page.request.post(new URL("/api/create-child", page.url()).toString(), {
        data: { name: "Student One" },
        headers: { "Content-Type": "application/json", "X-Requested-With": "dfg" },
      });
      expect(createOneRes.status()).toBe(200);
      const studentOne = await createOneRes.json();
      studentOneId = studentOne.id;

      const createTwoRes = await page.request.post(new URL("/api/create-child", page.url()).toString(), {
        data: { name: "Student Two" },
        headers: { "Content-Type": "application/json", "X-Requested-With": "dfg" },
      });
      expect(createTwoRes.status()).toBe(200);
      const studentTwo = await createTwoRes.json();
      studentTwoId = studentTwo.id;
    }

    // Go to book-lesson page
    await page.goto("/book-lesson");
    await expect(page.getByTestId("book-lesson")).toBeVisible();

    // Select Student One in the booking student selector
    await page.getByTestId("booking-student").click();
    await page.getByTestId(`select-option-${studentOneId}`).click();

    // Verify Student One is selected
    await expect(page.getByTestId("booking-student")).toContainText("Student One");

    // Switch to Student Two via dashboard
    await page.goto("/dashboard");
    await page.getByTestId(`switch-to-${studentTwoId}`).click();

    // Go back to book-lesson
    await page.goto("/book-lesson");
    await expect(page.getByTestId("book-lesson")).toBeVisible();

    // Booking student should now be Student Two (reset to active student)
    await expect(page.getByTestId("booking-student")).toContainText("Student Two");
  });
});