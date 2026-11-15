import { test, expect } from "./helpers.js";

test.describe("contact form", () => {
  test("a visitor sends a lesson inquiry", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const form = page.getByTestId("contact-form");
    await form.getByLabel("Name *").fill("Contact Visitor");
    await form.getByLabel("Email *").fill("contact-visitor@example.com");
    await form.getByRole("button", { name: /Instrument/ }).click();
    await page.getByRole("option", { name: "Guitar" }).click();
    await form.getByRole("button", { name: /Format/ }).click();
    await page.getByRole("option", { name: "Online" }).click();
    await form.getByRole("button", { name: "Send Message" }).click();

    await expect(page.getByRole("heading", { name: "Message Sent!" })).toBeVisible();
  });

  // A post before hydration is a plain form post to the server function. A refusal must come
  // back to the form with its message, not as the server function's raw response.
  test("a refused post before hydration shows its message on the form", async ({ page }) => {
    await page.goto("/");
    const action = await page.getByTestId("contact-form").getAttribute("action");
    const origin = new URL(page.url()).origin;
    const response = await page.request.post(new URL(action ?? "", origin).toString(), {
      headers: { origin, "sec-fetch-site": "same-origin" },
      form: {
        name: "Bot",
        email: "bot@example.com",
        instrument: "guitar",
        format: "online",
        website: "https://spam.example",
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    const location = new URL(response.headers().location ?? "", origin);
    expect(location.hash).toBe("#contact");

    await page.goto(location.toString());
    await expect(page.getByTestId("contact-error")).toHaveText("Invalid submission");
  });
});
