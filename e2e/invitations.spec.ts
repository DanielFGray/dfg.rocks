import type { Page } from "@playwright/test";
import { test, expect, loginViaUi } from "./helpers.js";

/** Leaves the admin's session, so the invite link is followed as the invited person. */
async function signOut(page: Page) {
  await page.goto("about:blank");
  await page.context().clearCookies({ name: "session" });
}

async function invite(
  page: Page,
  values: { name: string; email: string; role?: "Parent"; message?: string },
) {
  await page.getByTestId("invite-student").click();
  const form = page.getByTestId("invite-form");
  await form.getByLabel("Name").fill(values.name);
  await form.getByLabel("Email").fill(values.email);
  if (values.role) {
    await form.getByRole("button", { name: /Role/ }).click();
    await page.getByRole("option", { name: values.role }).click();
  }
  if (values.message) await form.getByTestId("invite-message").fill(values.message);
  await form.getByRole("button", { name: "Send Invite" }).click();
}

test.describe("account invitations", () => {
  test("staff invite a student, whose email link logs them in once", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-people").click();

    await invite(page, {
      name: "Test Jane",
      email: "test-jane@test.local",
      message: "Welcome aboard!\nSee you Tuesday.",
    });
    await expect(page.getByTestId("invite-sent")).toContainText("Test Jane");
    await expect(page.getByTestId("pending-invitation-Test_Jane")).toContainText(
      "test-jane@test.local",
    );
    // The account exists before the person logs in, so staff can open it now.
    await expect(page.getByRole("link", { name: "Test Jane" }).first()).toBeVisible();

    const link = await testing.invitationLink("test-jane@test.local");
    await signOut(page);
    await page.goto(link);
    await expect(page.getByTestId("invite-page")).toContainText("Welcome, Test Jane!");
    await expect(page.getByTestId("invite-message")).toContainText("See you Tuesday.");

    // Opening the page uses nothing up: a mail scanner may fetch the link first.
    await page.reload();
    await page.getByTestId("invite-continue").click();
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 });
    const me = await (await page.request.get("/api/me")).json();
    expect(me.user).toMatchObject({ username: "Test_Jane", role: "student", is_verified: true });

    await signOut(page);
    await page.goto(link);
    await expect(page.getByTestId("invite-invalid")).toBeVisible();
  });

  test("an email that already has an account is not invited", async ({ page, testing }) => {
    await testing.login();
    await testing.login({
      username: "test_existing",
      role: "student",
      name: "Existing Student",
      email: "test-existing@test.local",
    });
    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-people").click();

    await invite(page, { name: "Someone Else", email: "test-existing@test.local" });
    const taken = page.getByTestId("invite-email-taken");
    await expect(taken).toBeVisible();
    await taken.getByRole("link", { name: "Existing Student" }).click();
    await expect(page).toHaveURL(/\/people\//);
  });

  test("resending replaces the link", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    await page.getByTestId("nav-people").click();

    await invite(page, { name: "Test Parent Pat", email: "test-pat@test.local", role: "Parent" });
    await expect(page.getByTestId("pending-invitation-Test_Parent_Pat")).toBeVisible();
    const first = await testing.invitationLink("test-pat@test.local");

    await page.getByTestId("resend-invitation-Test_Parent_Pat").click();
    await expect(page.getByTestId("resend-invitation-Test_Parent_Pat")).toHaveText("Sent again");
    const second = await testing.invitationLink("test-pat@test.local");
    expect(second).not.toEqual(first);

    await signOut(page);
    await page.goto(first);
    await expect(page.getByTestId("invite-invalid")).toBeVisible();
    await page.goto(second);
    await page.getByTestId("invite-continue").click();
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 });
    const me = await (await page.request.get("/api/me")).json();
    expect(me.user).toMatchObject({ username: "Test_Parent_Pat", role: "parent" });
  });
});
