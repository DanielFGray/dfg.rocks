import { test, expect, getCy, loginViaUi } from "./helpers.js";

test.describe("students management", () => {
  test("admin sees students page with roster", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_student1",
      role: "student",
      name: "Alice Student",
      email: "alice@test.local",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await getCy(page, "nav-students").click();
    await expect(getCy(page, "students")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Students" }),
    ).toBeVisible();
    await expect(page.getByText("Alice Student")).toBeVisible();
  });

  test("admin can create a student", async ({ page, testing }) => {
    await testing.login();

    await loginViaUi(page, "test_admin", "testpassword123");
    await getCy(page, "nav-students").click();
    await expect(getCy(page, "students")).toBeVisible();

    await getCy(page, "new-student").click();
    const form = getCy(page, "student-form");
    await form.locator('input[name="name"]').fill("Bob Learner");
    await form.locator('input[name="username"]').fill("test_bob");
    await form.locator('input[name="email"]').fill("bob@test.local");
    await form.locator('button[type="submit"]').click();

    await expect(page.getByText("Bob Learner")).toBeVisible();
  });

  test("student name links to detail page", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_student2",
      role: "student",
      name: "Carol Musician",
      email: "carol@test.local",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await getCy(page, "nav-students").click();
    await page.getByText("Carol Musician").first().click();

    await expect(getCy(page, "student-detail")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Carol Musician" }),
    ).toBeVisible();
  });
});
