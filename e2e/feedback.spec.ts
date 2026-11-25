import { test, expect, type Page, type Route } from "@playwright/test";

/** Counts the POSTs the page sends to /api/feedback. */
const countFeedbackPosts = (page: Page) => {
  let count = 0;
  void page.route("**/api/feedback", (route: Route) => {
    count++;
    return route.continue();
  });
  return () => count;
};

test.describe("feedback dialog", () => {
  test("the Feedback link opens the dialog and a visitor sends feedback", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("feedback-link").click();
    const dialog = page.getByTestId("feedback-form");
    await expect(dialog).toBeVisible();
    await page.getByTestId("feedback-message").fill("The pricing table wraps on my phone");
    await page.getByRole("button", { name: /Category/ }).click();
    await page.getByRole("option", { name: "Bug" }).click();
    await page.getByTestId("feedback-submit").click();
    await expect(page.getByTestId("feedback-success")).toBeVisible();
  });

  test("the dialog sends the hidden honeypot field, and the server refuses it", async ({
    page,
  }) => {
    let body: Record<string, unknown> | undefined;
    await page.route("**/api/feedback", async (route) => {
      body = route.request().postDataJSON() as Record<string, unknown>;
      await route.continue();
    });
    await page.goto("/");
    await page.getByTestId("feedback-link").click();
    await page.getByTestId("feedback-message").fill("A bot wrote this");
    await page.getByRole("button", { name: /Category/ }).click();
    await page.getByRole("option", { name: "Bug" }).click();
    // A bot fills the hidden input directly; fill() would refuse a display:none field.
    await page
      .getByTestId("feedback-form")
      .locator('input[name="website"]')
      .evaluate((el, value) => {
        (el as HTMLInputElement).value = value;
      }, "https://spam.example");
    await page.getByTestId("feedback-submit").click();
    // The dialog put the honeypot on the wire, so the server refused the post.
    await expect(page.getByTestId("feedback-error")).toBeVisible();
    expect(body?.website).toBe("https://spam.example");
  });

  test("the dialog refuses to send without a category", async ({ page }) => {
    const postCount = countFeedbackPosts(page);
    await page.goto("/");
    await page.getByTestId("feedback-link").click();
    await page.getByTestId("feedback-message").fill("No category chosen");
    await page.getByTestId("feedback-submit").click();
    await expect(page.getByTestId("feedback-form")).toBeVisible();
    // The claim is "does not send": give any late request three seconds to appear.
    const sent = page
      .waitForRequest("**/api/feedback", { timeout: 3000 })
      .then(
        () => true,
        () => false,
      );
    expect(await sent).toBe(false);
    expect(postCount()).toBe(0);
    await expect(page.getByTestId("feedback-success")).toHaveCount(0);
  });
});
