import fs from "fs/promises";
import path from "path";
import { test, expect, loginViaUi } from "./helpers.js";

const notationFixturePath = path.join(
  process.cwd(),
  "uploads",
  "20434311-ceb3-43ba-a489-aa83ac477167.gp5",
);

test.describe("library", () => {
  test("admin can upload a material and see it in the library", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");

    const title = `Test Upload ${Date.now()}`;
    const fixturePath = path.join(process.cwd(), "e2e", ".tmp-upload.pdf");
    let materialId: string | null = null;

    await fs.writeFile(fixturePath, "%PDF-1.4\n% Test upload fixture\n");

    try {
      await page.getByTestId("nav-library").click();
      await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

      await page.getByTestId("upload-material").click();
      const form = page.getByTestId("upload-material-form");
      await expect(form).toBeVisible();

      await form.getByLabel("Title").fill(title);
      await form.getByLabel("File").setInputFiles(fixturePath);

      const uploadResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/admin/materials/upload") &&
          response.request().method() === "POST",
      );
      await form.locator('button[type="submit"]').click();

      const uploadResponse = await uploadResponsePromise;
      expect(uploadResponse.ok()).toBe(true);
      const uploaded = (await uploadResponse.json()) as {
        id: string;
        title: string;
      };
      materialId = uploaded.id;
      expect(uploaded.title).toBe(title);

      const row = page.getByTestId("material-row").filter({ hasText: title });
      await expect(row).toBeVisible();

      const deleteResponse = await page.request.delete(`/api/admin/materials/${materialId}`, {
        headers: { "X-Requested-With": "dfg" },
      });
      expect(deleteResponse.ok()).toBe(true);
      materialId = null;
    } finally {
      if (materialId) {
        await page.request.delete(`/api/admin/materials/${materialId}`, {
          headers: { "X-Requested-With": "dfg" },
        });
      }
      await fs.rm(fixturePath, { force: true });
    }
  });

  test("admin upload detects notation tracks before submit", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");

    await page.getByTestId("nav-library").click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    await page.getByTestId("upload-material").click();
    const form = page.getByTestId("upload-material-form");
    await expect(form).toBeVisible();

    await form.getByLabel("Title").fill("Notation Track Detection");
    await form.getByLabel("File").setInputFiles(notationFixturePath);

    await expect(form.getByText("Detected 4 tracks")).toBeVisible();
    await expect(form.getByText("Guitar 1")).toBeVisible();
    await expect(form.getByText("Bass")).toBeVisible();
    await expect(form.getByText("Drums")).toBeVisible();
  });
});
