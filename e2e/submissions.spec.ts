import { test, expect, loginViaUi } from "./helpers.js";

test.describe("submissions", () => {
  test("submissions page renders", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-submissions").click();
    await expect(page.getByTestId("submissions")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contact Submissions" })).toBeVisible();
  });
});

test.describe("submissions spam filter", () => {
  test("the inbox leaves spam out and the filter shows it", async ({ page, testing }) => {
    await testing.login();
    await testing.seedSubmission({ name: "Real Inquiry", email: "test-real@example.com" });
    await testing.seedSubmission({
      name: "Bot Spammer",
      email: "test-bot@example.com",
      spam_reason: "proxy",
    });
    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-submissions").click();

    const submissions = page.getByTestId("submissions");
    await expect(submissions.getByText("Real Inquiry")).toBeVisible();
    await expect(submissions.getByText("Bot Spammer")).toHaveCount(0);

    await page.getByTestId("spam-filter").click();
    await expect(submissions.getByText("Bot Spammer")).toBeVisible();
    await expect(submissions.getByText("Real Inquiry")).toHaveCount(0);
  });

  test("a submission can be marked as spam and put back", async ({ page, testing }) => {
    await testing.login();
    await testing.seedSubmission({ name: "Marked Inquiry", email: "test-marked@example.com" });
    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-submissions").click();

    const submissions = page.getByTestId("submissions");
    const row = submissions
      .getByText("Marked Inquiry")
      .locator("xpath=ancestor::div[contains(@class,'rounded-xl')]")
      .first();
    await expect(row).toBeVisible();

    // Marking it as spam takes it out of the inbox and into the spam list.
    await row.getByTestId("toggle-spam").click();
    await expect(submissions.getByText("Marked Inquiry")).toHaveCount(0);

    await page.getByTestId("spam-filter").click();
    const spamRow = submissions
      .getByText("Marked Inquiry")
      .locator("xpath=ancestor::div[contains(@class,'rounded-xl')]")
      .first();
    await expect(spamRow).toBeVisible();
    await expect(spamRow.getByTestId("spam-reason")).toBeVisible();

    // Putting it back returns it to the inbox.
    await spamRow.getByTestId("toggle-spam").click();
    await page.getByTestId("spam-filter").click();
    await expect(submissions.getByText("Marked Inquiry")).toBeVisible();
  });
});
