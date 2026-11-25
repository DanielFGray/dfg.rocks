import { test, expect } from "./helpers.js";

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

  test("the dialog refuses to send without a category", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("feedback-link").click();
    await page.getByTestId("feedback-message").fill("No category chosen");
    // The category select is required, so the browser blocks the submit.
    await page.getByTestId("feedback-submit").click();
    await expect(page.getByTestId("feedback-form")).toBeVisible();
    await expect(page.getByTestId("feedback-success")).toHaveCount(0);
  });
});
