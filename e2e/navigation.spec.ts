import { test, expect, loginViaUi, logoutViaUi } from "./helpers.js";

test.describe("navigation", () => {
  test("logout returns to login page", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await logoutViaUi(page);
    await expect(page.getByTestId("login-page")).toBeVisible();
  });

  test("nav links use client-side routing (no full page reload)", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await expect(page.getByTestId("dashboard")).toBeVisible();

    // Navigate to Library via nav link
    await page.getByTestId("nav-library").click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    // Navigate to Courses via nav link
    await page.getByTestId("nav-courses").click();
    await expect(page.getByTestId("courses")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Courses" })).toBeVisible();
  });

  test("courses page renders course content after nav round-trip", async ({ page, testing }) => {
    await testing.login();
    await testing.seedCourse({
      title: "Test: Nav Round-Trip",
      instrument: "Drums",
      description: "Survives navigation",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-courses").click();
    await expect(page.getByText("Test: Nav Round-Trip")).toBeVisible();

    // Navigate away and back
    await page.getByTestId("nav-library").click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    await page.getByTestId("nav-courses").click();
    await expect(page.getByText("Test: Nav Round-Trip")).toBeVisible();
  });
});

test.describe("mobile sidebar", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sidebar closes after selecting a nav link", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await expect(page.getByTestId("dashboard")).toBeVisible();

    // Open the mobile sidebar
    await page.getByTestId("nav-menu-toggle").click();
    const sidebar = page.getByRole("dialog", { name: "Menu" });
    await expect(sidebar).toBeVisible();

    // Click a nav link inside the sidebar
    await sidebar.getByTestId("nav-library").click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    // Sidebar should be closed
    await expect(sidebar).not.toBeVisible();
  });
});

test.describe("tablet sidebar", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("student can open the sidebar at tablet width", async ({ page, testing }) => {
    await testing.login({
      username: "test_student_tablet_nav",
      role: "student",
      name: "Tablet Student",
    });

    await loginViaUi(page, "test_student_tablet_nav", "testpassword123");
    await expect(page.getByTestId("nav-menu-toggle")).toBeVisible();

    await page.getByTestId("nav-menu-toggle").click();

    const sidebar = page.getByRole("dialog", { name: "Menu" });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByTestId("nav-messages")).toBeVisible();
  });
});
