import { test, expect } from "./helpers.js";

// The free course migrations/current/7-content-visibility.sql seeds, at the id dfg.codes redirects to.
const freeCourseId = "b923f9a1-ae77-4daa-b434-67a06a8435a9";
const freeCoursePath = `/courses/${freeCourseId}`;

test.describe("free course", () => {
  test("a signed-in account with no enrollment reads both modules and sees a score", async ({
    page,
    testing,
  }) => {
    await testing.login({ username: "test_free_reader", role: "student", name: "Free Reader" });

    await page.goto(freeCoursePath);

    await expect(page.getByRole("heading", { name: "Drum rudiments" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Beginning drums" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rudimental permutations" })).toBeVisible();
    // The score is alphaTex in the module's content, drawn by gigbag.js. alphaTab draws a
    // score only once it is in the viewport, so scroll to it as a reader would.
    const score = page.getByTestId("alpha-tex-node").first();
    await score.scrollIntoViewIfNeeded();
    await expect(score.locator(".at-surface svg").first()).toBeVisible({ timeout: 20_000 });
  });

  test("an anonymous visitor signs in and returns to the course", async ({ page, testing }) => {
    await testing.login({ username: "test_free_returner", role: "student", name: "Free Returner" });
    await page.context().clearCookies({ name: "session" });

    await page.goto(freeCoursePath);
    await expect(page).toHaveURL(/\/login\?.*redirect=/);

    await page.getByTestId("login-id").fill("test_free_returner");
    await page.getByTestId("login-password").fill("testpassword123");
    await page.getByTestId("login-submit").click();

    await expect(page).toHaveURL(new RegExp(`${freeCoursePath}$`), { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Rudimental permutations" })).toBeVisible();
  });
});
