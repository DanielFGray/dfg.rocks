import { test, expect, getCy, loginViaUi } from "./helpers.js";

test.describe("courses", () => {
  test("admin sees seeded course", async ({ page, testing }) => {
    await testing.login();
    await testing.seedCourse({
      title: "Test: Guitar Fundamentals",
      instrument: "Guitar",
      description: "Learn the basics of guitar",
    });

    await loginViaUi(page, "test_admin", "testpassword123");
    await expect(page.getByText("Test: Guitar Fundamentals")).toBeVisible();
  });
});
