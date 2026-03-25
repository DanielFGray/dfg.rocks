import { test, expect, getPw, loginViaUi } from "./helpers.js";

test.describe("navigation", () => {
  test("logout returns to login page", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await getPw(page, "logout").click();
    await expect(getPw(page, "login-page")).toBeVisible();
  });

  test("nav links use client-side routing (no full page reload)", async ({
    page,
    testing,
  }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await expect(getPw(page, "dashboard")).toBeVisible();

    // Navigate to Library via nav link
    await getPw(page, "nav-library").click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    // Navigate back to Courses (dashboard) via nav link
    await getPw(page, "nav-courses").click();
    await expect(getPw(page, "dashboard")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Courses" }),
    ).toBeVisible();
  });

  test("dashboard renders course content after nav round-trip", async ({
    page,
    testing,
  }) => {
    await testing.login();
    await testing.seedCourse({
      title: "Test: Nav Round-Trip",
      instrument: "Drums",
      description: "Survives navigation",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await expect(page.getByText("Test: Nav Round-Trip")).toBeVisible();

    // Navigate away and back
    await getPw(page, "nav-library").click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    await getPw(page, "nav-courses").click();
    await expect(page.getByText("Test: Nav Round-Trip")).toBeVisible();
  });

});

test.describe("mobile sidebar", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sidebar closes after selecting a nav link", async ({
    page,
    testing,
  }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await expect(getPw(page, "dashboard")).toBeVisible();

    // Open the mobile sidebar
    await getPw(page, "nav-menu-toggle").click();
    const sidebar = page.locator(".fixed.inset-0").last();
    await expect(sidebar).toBeVisible();

    // Click a nav link inside the sidebar
    await sidebar.locator("[data-pwid=nav-library]").click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    // Sidebar should be closed
    await expect(sidebar).not.toBeVisible();
  });
});
