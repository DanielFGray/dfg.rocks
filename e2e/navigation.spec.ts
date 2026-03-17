import { test, expect, getCy, loginViaUi } from "./helpers.js";

test.describe("navigation", () => {
  test("logout returns to login page", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await getCy(page, "logout").click();
    await expect(getCy(page, "login-page")).toBeVisible();
  });

  test("nav links use client-side routing (no full page reload)", async ({
    page,
    testing,
  }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await expect(getCy(page, "dashboard")).toBeVisible();

    // Navigate to Library via nav link
    await getCy(page, "nav-library").click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    // Navigate back to Courses (dashboard) via nav link
    await getCy(page, "nav-courses").click();
    await expect(getCy(page, "dashboard")).toBeVisible();
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
    await getCy(page, "nav-library").click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    await getCy(page, "nav-courses").click();
    await expect(page.getByText("Test: Nav Round-Trip")).toBeVisible();
  });
});
