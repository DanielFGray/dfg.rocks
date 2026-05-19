import { test, expect, loginViaUi } from "./helpers.js";

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
    await page.getByTestId("nav-students").click();
    await expect(page.getByTestId("students")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Students" })).toBeVisible();
    await expect(page.getByText("Alice Student")).toBeVisible();
  });

  test("admin can invite a student to a family", async ({ page, testing }) => {
    await testing.login();
    // Seed a family via the invitation helper (creates family + invitation)
    await testing.seedInvitation({ email: "bob@test.local" });

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-students").click();
    await expect(page.getByTestId("students")).toBeVisible();

    await page.getByTestId("invite-student").click();
    const form = page.getByTestId("invite-form");
    // Select the family and fill email
    await form.getByRole("button", { name: /Family/ }).click();
    await page.getByRole("option").first().click();
    await form.getByLabel("Email").fill("carol@test.local");
    await form.getByRole("button", { name: "Send Invite" }).click();

    // Modal closes, back to students page
    await expect(page.getByTestId("students")).toBeVisible();
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
    await page.getByTestId("nav-students").click();
    await page.getByRole("link", { name: "Carol Musician" }).click();

    await expect(page.getByTestId("student-detail")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Carol Musician" })).toBeVisible();
  });
});
