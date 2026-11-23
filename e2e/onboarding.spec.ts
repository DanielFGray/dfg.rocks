import type { Page } from "@playwright/test";
import { test, expect, loginViaUi } from "./helpers.js";

const next = (page: Page) => page.getByTestId("onboarding-next").click();

async function chooseExperience(page: Page, testId: string, label: string) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: label }).click();
}

test.describe("onboarding", () => {
  test("an invited student sets up their account and profile once", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-people").click();
    await page.getByTestId("invite-student").click();
    const form = page.getByTestId("invite-form");
    await form.getByLabel("Name").fill("Test Sam");
    await form.getByLabel("Email").fill("test-sam@test.local");
    await form.getByTestId("invite-message").fill("Bring your sticks!");
    await form.getByRole("button", { name: "Send Invite" }).click();
    await expect(page.getByTestId("invite-sent")).toBeVisible();
    const link = await testing.invitationLink("test-sam@test.local");

    await page.goto("about:blank");
    await page.context().clearCookies({ name: "session" });
    await page.goto(link);
    await page.getByTestId("invite-continue").click();

    await expect(page.getByTestId("onboarding-message")).toContainText("Bring your sticks!");
    // The portal waits until onboarding is done.
    await page.goto("/lessons");
    await expect(page.getByTestId("onboarding-step-welcome")).toBeVisible();
    await next(page);

    await page.getByTestId("onboarding-username").fill("test_sam_drums");
    await page.getByTestId("onboarding-password").fill("short");
    await expect(page.getByTestId("onboarding-next")).toBeDisabled();
    await page.getByTestId("onboarding-password").fill("sam-password-1");
    await next(page);

    await page.getByTestId("me-instrument-drums").click();
    await chooseExperience(page, "me-experience-drums", "1–3 years");
    await page.getByTestId("me-instrument-other").click();
    await expect(page.getByTestId("onboarding-next")).toBeDisabled();
    await page.getByTestId("me-other-name").fill("Cajón");
    await next(page);

    await page.getByTestId("onboarding-background").fill("Played in a garage band.");
    await next(page);
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 });

    const state = await (await page.request.get("/api/onboarding")).json();
    expect(state).toMatchObject({
      username: "test_sam_drums",
      hasPassword: true,
      profile: {
        background: "Played in a garage band.",
        instruments: [
          { instrument: "drums", experience: "1_to_3_years" },
          { instrument: "other", experience: "none", other_instrument: "Cajón" },
        ],
      },
    });

    // Never again: not on a client-side visit, a reload, or the next login.
    await page.goto("/dashboard");
    await page.getByTestId("nav-settings").first().click();
    await expect(page).toHaveURL(/\/settings/);
    await page.goto("/onboarding");
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await loginViaUi(page, "test_sam_drums", "sam-password-1");
    await expect(page.getByTestId("dashboard")).toBeVisible();
  });

  test("a parent adds a child with the child's instruments", async ({ page, testing }) => {
    await testing.login({
      username: "test_new_parent_onb",
      role: "parent",
      name: "Pat Parent",
      onboarded: false,
    });
    await page.goto("/dashboard");
    await expect(page.getByTestId("onboarding-step-welcome")).toBeVisible();
    await next(page);
    // This account already has a password, so the step does not offer one.
    await expect(page.getByTestId("onboarding-password")).toHaveCount(0);
    await next(page);

    await page.getByTestId("child-name-input").fill("Kit Parent");
    await page.getByTestId("child-instrument-guitar").click();
    await chooseExperience(page, "child-experience-guitar", "Less than a year");
    // A typed student must be added before the parent can finish.
    await expect(page.getByTestId("onboarding-next")).toBeDisabled();
    await page.getByTestId("add-student-submit").click();
    await expect(page.getByTestId("onboarding-children")).toContainText("Kit Parent");

    await next(page);
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 });
    const me = await (await page.request.get("/api/me")).json();
    expect(me.needsOnboarding).toBe(false);
    expect(me.familyStudents.map((child: { name: string }) => child.name)).toEqual(["Kit Parent"]);
  });
});
