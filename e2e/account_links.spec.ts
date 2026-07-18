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
    await page.getByTestId("accept-invite-password").fill("testpassword123");

    await page.getByTestId("accept-invite-submit").click();
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

    await page.getByTestId("confirm-delete-account-submit").click();
    await expect(page).toHaveURL(/\/$/);
  });
});
