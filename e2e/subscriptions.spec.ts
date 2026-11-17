import { test, expect } from "./helpers.js";

// Stripe is faked for E2E (server/services/stripeFake.ts): the prices are $15.00 a month and
// $150.00 a year, Checkout and the portal return to the app, and no request leaves the server. The
// subscription rows are seeded through the testing API, as the webhook would write them.

test.describe("subscriptions", () => {
  test("a signed-out reader sees both plans, and Subscribe goes to sign-in and back", async ({
    page,
    testing,
  }) => {
    await testing.clear();
    await testing.login({ username: "test_sub_signed_out", role: "student" });
    await page.context().clearCookies({ name: "session" });

    await page.goto("/pricing");
    await expect(page.getByTestId("price-monthly")).toHaveText("$15.00");
    await expect(page.getByTestId("price-annual")).toHaveText("$150.00");

    await page.getByTestId("subscribe-monthly").click();
    await expect(page).toHaveURL(/\/login\?redirect=/);
    await page.getByTestId("login-id").fill("test_sub_signed_out");
    await page.getByTestId("login-password").fill("testpassword123");
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test("a signed-in reader is sent through Checkout, and the success page waits for the webhook", async ({
    page,
    testing,
  }) => {
    await testing.clear();
    await testing.login({ username: "test_sub_checkout", role: "student" });

    await page.goto("/pricing");
    await page.getByTestId("subscribe-annual").click();

    await expect(page).toHaveURL(/\/subscribe\/success$/);
    await expect(page.getByTestId("subscription-pending")).toBeVisible();

    await testing.seedSubscription({ username: "test_sub_checkout", plan: "annual" });
    await expect(page.getByTestId("subscribed")).toBeVisible({ timeout: 15_000 });
  });

  test("settings shows a past-due subscription, and Manage subscription opens the portal", async ({
    page,
    testing,
  }) => {
    await testing.clear();
    await testing.login({ username: "test_sub_past_due", role: "student" });
    await testing.seedSubscription({
      username: "test_sub_past_due",
      plan: "monthly",
      status: "past_due",
    });

    await page.goto("/settings");
    await expect(page.getByTestId("subscription-status")).toContainText("is past due");
    await page.getByTestId("manage-subscription").click();
    await expect(page).toHaveURL(/portal=opened/);
  });

  test("settings says when an active subscription renews, and when a cancelled one ends", async ({
    page,
    testing,
  }) => {
    await testing.clear();
    await testing.login({ username: "test_sub_renews", role: "student" });
    await testing.seedSubscription({ username: "test_sub_renews", plan: "monthly" });
    await page.goto("/settings");
    await expect(page.getByTestId("subscription-status")).toContainText("Monthly renews on");

    await testing.login({ username: "test_sub_ends", role: "student" });
    await testing.seedSubscription({
      username: "test_sub_ends",
      plan: "annual",
      cancelAtPeriodEnd: true,
    });
    await page.goto("/settings");
    await expect(page.getByTestId("subscription-status")).toContainText("Annual ends on");
  });

  test("a family member whose billing contact pays sees who pays, and cannot manage it", async ({
    page,
    testing,
  }) => {
    await testing.clear();
    const slug = "sub-family-billing";
    await testing.login({ username: "test_sub_billing_parent", role: "parent" });
    await testing.seedFamily({ slug, name: "Billing Family" });
    await testing.seedFamilyMembership({
      username: "test_sub_billing_parent",
      family_slug: slug,
      is_owner: true,
      is_billing_contact: true,
    });
    await testing.seedSubscription({ username: "test_sub_billing_parent", plan: "monthly" });

    await testing.login({ username: "test_sub_billing_kid", role: "student" });
    await testing.seedFamilyMembership({ username: "test_sub_billing_kid", family_slug: slug });

    await page.goto("/settings");
    await expect(page.getByTestId("subscription-billing-contact")).toContainText(
      "billing contact manages the subscription",
    );
    await expect(page.getByTestId("manage-subscription")).toHaveCount(0);
  });

  test("a locked course shows Subscribe, and opens once the reader's subscription is recorded", async ({
    page,
    testing,
  }) => {
    await testing.clear();
    const title = "Test: Subscription Course";
    await testing.seedCourse({ title, instrument: "Guitar" });

    // Only an admin's course list links to the course, so the admin reads its id from the URL.
    await testing.login();
    await page.goto("/courses");
    await page.getByText(title).click();
    await page.waitForURL(/\/courses\/[^/]+$/);
    const coursePath = new URL(page.url()).pathname;

    await testing.login({ username: "test_sub_locked", role: "student" });
    await page.goto(coursePath);
    await expect(page.getByTestId("course-locked")).toBeVisible();
    await page.getByTestId("subscribe-cta").click();
    await expect(page).toHaveURL(/\/pricing$/);

    await testing.seedSubscription({ username: "test_sub_locked", plan: "monthly" });
    await page.goto(coursePath);
    await expect(page.getByTestId("course-locked")).toHaveCount(0);
    await expect(page.getByText(title)).toBeVisible();
  });

  test("a parent who is not the billing contact sees the family's subscription and cannot subscribe", async ({
    page,
    testing,
  }) => {
    await testing.clear();
    const slug = "sub-family-non-billing";
    await testing.login({ username: "test_sub_contact_parent", role: "parent" });
    await testing.seedFamily({ slug, name: "Contact Family" });
    await testing.seedFamilyMembership({
      username: "test_sub_contact_parent",
      family_slug: slug,
      is_owner: true,
      is_billing_contact: true,
    });
    await testing.seedSubscription({ username: "test_sub_contact_parent", plan: "monthly" });

    await testing.login({ username: "test_sub_other_parent", role: "parent" });
    await testing.seedFamilyMembership({
      username: "test_sub_other_parent",
      family_slug: slug,
      is_owner: false,
      is_billing_contact: false,
    });

    await page.goto("/settings");
    await expect(page.getByTestId("subscription-billing-contact")).toContainText(
      "billing contact manages the subscription",
    );
    await expect(page.getByTestId("manage-subscription")).toHaveCount(0);

    await page.goto("/pricing");
    await expect(page.getByTestId("checkout-blocked").first()).toContainText("already covers you");
    await expect(page.getByTestId("subscribe-monthly")).toHaveCount(0);
  });
});

test.describe("a course that does not exist", () => {
  test.use({ expectMissingPages: true });

  test("shows the not-found page, not a subscription prompt", async ({ page, testing }) => {
    await testing.clear();
    await testing.login({ username: "test_sub_missing_course", role: "student" });

    await page.goto("/courses/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText("Not Found")).toBeVisible();
    await expect(page.getByTestId("course-locked")).toHaveCount(0);

    await page.goto("/courses/not-a-course-id");
    await expect(page.getByText("Not Found")).toBeVisible();
    await expect(page.getByTestId("course-locked")).toHaveCount(0);
  });
});
