import { test, expect } from "./helpers.js";

test.describe("messages", () => {
  test("conversation list selects one conversation and moves with arrow keys", async ({
    page,
    testing,
  }) => {
    // The admin must exist before the messages are seeded; each login replaces the
    // session cookie, so the admin's login runs again last to browse as the admin.
    await testing.login({ username: "test_admin", role: "admin" });
    await testing.login({ username: "test_student_one", role: "student", name: "Student One" });
    await testing.login({ username: "test_student_two", role: "student", name: "Student Two" });
    await testing.seedMessage({
      sender_username: "test_student_one",
      recipient_username: "test_admin",
      body: "Hello from Student One",
    });
    await testing.seedMessage({
      sender_username: "test_student_two",
      recipient_username: "test_admin",
      body: "Hello from Student Two",
    });
    await testing.login({ username: "test_admin", role: "admin" });

    await page.goto("/messages");
    await expect(page.getByTestId("messages")).toBeVisible();

    const list = page.getByRole("grid", { name: "Conversations" });
    const studentOne = list.getByRole("row", { name: /Student One/ });
    const studentTwo = list.getByRole("row", { name: /Student Two/ });

    // Messages load newest-first, so Student Two (seeded last) is the first conversation
    // and auto-selected on load.
    await expect(studentOne).toHaveAttribute("aria-selected", "false");
    await expect(studentTwo).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Student Two" })).toBeVisible();
    // Down moves selection to the next conversation and swaps the thread.
    await studentTwo.press("ArrowDown");
    await expect(studentOne).toHaveAttribute("aria-selected", "true");
    await expect(studentTwo).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("heading", { name: "Student One" })).toBeVisible();

    // Up moves back.
    await studentOne.press("ArrowUp");
    await expect(studentTwo).toHaveAttribute("aria-selected", "true");
    await expect(studentOne).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("heading", { name: "Student Two" })).toBeVisible();

    // Down moves back.
    await studentOne.press("ArrowDown");
    await expect(studentTwo).toHaveAttribute("aria-selected", "true");
    await expect(studentOne).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("heading", { name: "Student Two" })).toBeVisible();
  });
});
