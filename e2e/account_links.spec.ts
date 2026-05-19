import { test, expect, loginViaUi } from "./helpers.js";

test.describe("account link flows", () => {
  test("accept invite page creates an account", async ({ page, testing }) => {
    await testing.login();
    const inviteUrl = await testing.seedInvitation({ email: "new-parent@test.local" });

    await page.goto(inviteUrl);
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("accept-invite-page")).toBeVisible();
    await expect(page.getByText("Test Family")).toBeVisible();

    await page.getByTestId("accept-invite-name").fill("New Parent");
    await page.getByTestId("accept-invite-username").fill("test_new_parent");
    await page.getByTestId("accept-invite-role").click();
    await page.getByRole("option", { name: "Parent" }).click();
    await page.getByTestId("accept-invite-password").fill("testpassword123");

    const acceptResponsePromise = page
      .waitForResponse(
        (response) =>
          response.url().includes("/api/invitation/") && response.url().includes("/accept"),
        { timeout: 5_000 },
      )
      .catch(() => null);

    await page.getByTestId("accept-invite-submit").click();

    const acceptResponse = await acceptResponsePromise;
    expect(acceptResponse?.ok(), acceptResponse ? await acceptResponse.text() : "No accept request").toBe(
      true,
    );

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId("dashboard")).toBeVisible();
  });

  test("confirm delete account page deletes the signed-in account", async ({ page, testing }) => {
    await testing.login({
      username: "test_delete_me",
      role: "student",
      name: "Delete Me",
      email: "delete-me@test.local",
    });

    await loginViaUi(page, "test_delete_me", "testpassword123");

    const deleteUrl = await testing.seedDeleteAccountLink({ username: "test_delete_me" });
    await page.goto(deleteUrl);
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("confirm-delete-account-page")).toBeVisible();

    const deleteResponsePromise = page
      .waitForResponse(
        (response) =>
          response.url().includes("/api/confirm-delete-account") &&
          response.request().method() === "POST",
        { timeout: 5_000 },
      )
      .catch(() => null);

    await page.getByTestId("confirm-delete-account-submit").click();

    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse?.ok(), deleteResponse ? await deleteResponse.text() : "No delete request").toBe(
      true,
    );

    await expect(page).toHaveURL(/\/$/);

    for (let attempt = 0; attempt < 2; attempt++) {
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
      await page.getByTestId("login-id").fill("test_delete_me");
      await page.getByTestId("login-password").fill("testpassword123");

      const loginResponsePromise = page
        .waitForResponse(
          (response) =>
            response.url().includes("/api/login") && response.request().method() === "POST",
          { timeout: 5_000 },
        )
        .catch(() => null);

      await page.getByTestId("login-submit").click();

      const loginResponse = await loginResponsePromise;
      if (!loginResponse) {
        if (attempt === 0) {
          continue;
        }
        throw new Error("Login request did not fire");
      }

      expect(loginResponse.ok()).toBe(false);
      break;
    }

    await expect(page.getByTestId("login-error")).toBeVisible();
  });
});
