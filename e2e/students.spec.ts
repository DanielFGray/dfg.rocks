import { test, expect, getPw, loginViaUi } from "./helpers.js";

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
    await getPw(page, "nav-students").click();
    await expect(getPw(page, "students")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Students" }),
    ).toBeVisible();
    await expect(page.getByText("Alice Student")).toBeVisible();
  });

  test("admin can invite a student to a family", async ({ page, testing }) => {
    await testing.login();
    // Seed a family via the invitation helper (creates family + invitation)
    await testing.seedInvitation({ email: "bob@test.local" });

    await loginViaUi(page, "test_admin", "testpassword123");
    await getPw(page, "nav-students").click();
    await expect(getPw(page, "students")).toBeVisible();

    await getPw(page, "invite-student").click();
    const form = getPw(page, "invite-form");
    // Select the family and fill email
    await form.locator('select[name="family_id"]').selectOption({ index: 0 });
    await form.locator('input[name="email"]').fill("carol@test.local");
    await form.locator('button[type="submit"]').click();

    // Modal closes, back to students page
    await expect(getPw(page, "students")).toBeVisible();
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
    await getPw(page, "nav-students").click();
    await page.getByText("Carol Musician").first().click();

    await expect(getPw(page, "student-detail")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Carol Musician" }),
    ).toBeVisible();
  });
});
