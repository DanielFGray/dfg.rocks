import { test, expect, loginViaUi } from "./helpers.js";
import type { Page } from "@playwright/test";

type Child = { id: string; username: string };

const createChild = async (page: Page, name: string): Promise<Child> => {
  const res = await page.request.post(new URL("/api/create-child", page.url()).toString(), {
    data: { name },
    headers: { "Content-Type": "application/json", "X-Requested-With": "dfg" },
  });
  expect(res.status()).toBe(200);
  return res.json();
};

/**
 * Creating a child makes it the session's active student, so a fresh login (a session with no
 * active student) is the parent's starting point: it shows the student cards.
 */
const loginAsParentWithTwoChildren = async (page: Page) => {
  await loginViaUi(page, "test_parent_parity", "testpassword123");
  const one = await createChild(page, "Student One");
  const two = await createChild(page, "Student Two");
  await loginViaUi(page, "test_parent_parity", "testpassword123");
  return { one, two };
};

/** The nav switcher is the way to change student once one is active; the cards show only with none. */
const switchViaNav = async (page: Page, student: Child, name: string) => {
  await page.locator('[data-testid="student-switcher"]:visible').click();
  await page.getByTestId(`select-option-${student.id}`).click();
  await expect(page.locator('[data-testid="student-switcher"]:visible')).toContainText(name);
};

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
    const { one, two } = await loginAsParentWithTwoChildren(page);

    // Should show ParentDashboard initially (no active student)
    await expect(page.getByText("Your Students")).toBeVisible();
    await expect(page.getByTestId(`student-card-${one.id}`)).toBeVisible();
    await expect(page.getByTestId(`student-card-${two.id}`)).toBeVisible();

    // Switch to Student One
    await page.getByTestId(`switch-to-${one.id}`).click();
    await expect(page.getByTestId("dashboard")).toBeVisible();
    // Dashboard should now show Student One's view
    await expect(page.getByText("Welcome back, Student")).toBeVisible();

    // Verify dashboard shows Student One's data (no lessons, no messages initially)
    await expect(page.getByText("No upcoming lessons")).toBeVisible();

    // Switch to Student Two
    await switchViaNav(page, two, "Student Two");
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await expect(page.getByText("Welcome back, Student")).toBeVisible();
    await expect(page.getByText("No upcoming lessons")).toBeVisible();
  });

  test("parent switching children updates courses page", async ({ page, testing }) => {
    const { one, two } = await loginAsParentWithTwoChildren(page);

    // Seed courses for each student
    await testing.seedCourse({
      title: "Piano Basics",
      instrument: "piano",
    });
    await testing.enroll(one.username, "Piano Basics");

    await testing.seedCourse({
      title: "Guitar Fundamentals",
      instrument: "guitar",
    });
    await testing.enroll(two.username, "Guitar Fundamentals");

    // Switch to Student One
    await page.getByTestId(`switch-to-${one.id}`).click();
    await page.goto("/courses");
    await expect(page.getByTestId("courses")).toBeVisible();
    await expect(page.getByText("Piano Basics")).toBeVisible();
    await expect(page.getByText("Guitar Fundamentals")).not.toBeVisible();

    // Switch to Student Two
    await switchViaNav(page, two, "Student Two");
    await page.goto("/courses");
    await expect(page.getByTestId("courses")).toBeVisible();
    await expect(page.getByText("Guitar Fundamentals")).toBeVisible();
    await expect(page.getByText("Piano Basics")).not.toBeVisible();
  });

  test("parent switching children updates messages page", async ({ page }) => {
    const { one, two } = await loginAsParentWithTwoChildren(page);

    // Switch to Student One
    await page.getByTestId(`switch-to-${one.id}`).click();
    await page.goto("/messages");
    await expect(page.getByTestId("messages")).toBeVisible();

    // Switch to Student Two
    await switchViaNav(page, two, "Student Two");
    await page.goto("/messages");
    await expect(page.getByTestId("messages")).toBeVisible();
  });

  test("parent sees unavailable booking when Google Calendar is disconnected", async ({ page }) => {
    const { two } = await loginAsParentWithTwoChildren(page);

    // Go to book-lesson page
    await page.goto("/book-lesson");
    await expect(page.getByTestId("book-lesson")).toBeVisible();
    await expect(
      page.getByText(
        "Online booking is unavailable right now. Please contact your teacher to book a lesson.",
      ),
    ).toBeVisible();

    // Switch to Student Two through the nav switcher
    await switchViaNav(page, two, "Student Two");

    // Go back to book-lesson
    await page.goto("/book-lesson");
    await expect(page.getByTestId("book-lesson")).toBeVisible();
    await expect(
      page.getByText(
        "Online booking is unavailable right now. Please contact your teacher to book a lesson.",
      ),
    ).toBeVisible();
  });
});
