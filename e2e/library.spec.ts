import fs from "fs/promises";
import path from "path";
import { test, expect, loginViaUi } from "./helpers.js";

const notationFixturePath = path.join(process.cwd(), "e2e", "fixtures", "fixture-score.musicxml");

test.describe("library", () => {
  test("admin can upload a material and see it in the library", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");

    const expectedTitle = "Moonlight Sonata";
    const tempDir = path.join(process.cwd(), "e2e", ".tmp");
    const fixturePath = path.join(tempDir, "Moonlight-Sonata.pdf");
    let materialId: string | null = null;

    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(fixturePath, `%PDF-1.4\n% Test upload fixture ${Date.now()}\n`);

    try {
      await page.getByTestId("nav-library").click();
      await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

      await page.getByTestId("upload-material").click();
      const form = page.getByTestId("upload-material-form");
      await expect(form).toBeVisible();

      await form.getByLabel("File").setInputFiles(fixturePath);
      await expect(form.getByLabel("Title")).toHaveValue(expectedTitle);

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
      expect(uploaded.title).toBe(expectedTitle);

      const row = page.getByTestId("material-row").filter({ hasText: expectedTitle });
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

  test("admin upload prefills score titles and keeps manual edits", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    const tempDir = path.join(process.cwd(), "e2e", ".tmp");
    const fallbackFixturePath = path.join(tempDir, "manual-override.pdf");

    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(fallbackFixturePath, `%PDF-1.4\n% Manual override fixture ${Date.now()}\n`);

    try {
      await page.getByTestId("nav-library").click();
      await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

      await page.getByTestId("upload-material").click();
      const form = page.getByTestId("upload-material-form");
      await expect(form).toBeVisible();

      await form.getByLabel("File").setInputFiles(notationFixturePath);

      await expect(form.getByLabel("Title")).toHaveValue("Fixture Score Title");
      await expect(form.getByText("Detected 3 tracks")).toBeVisible();
      await expect(form.getByText("Guitar 1")).toBeVisible();
      await expect(form.getByText("Bass")).toBeVisible();
      await expect(form.getByText("Drums")).toBeVisible();

      await form.getByLabel("Title").fill("Manual Override");
      await form.getByLabel("File").setInputFiles(fallbackFixturePath);
      await expect(form.getByLabel("Title")).toHaveValue("Manual Override");
    } finally {
      await fs.rm(fallbackFixturePath, { force: true });
    }
  });
});
