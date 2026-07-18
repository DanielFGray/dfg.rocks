import fs from "fs/promises";
import path from "path";
import { test, expect, loginViaUi } from "./helpers.js";

const notationFixturePath = path.join(process.cwd(), "e2e", "fixtures", "fixture-score.musicxml");

test.describe("library", () => {
  test("students are redirected away from the library route", async ({ page, testing }) => {
    await testing.login({
      username: "test_student",
      password: "testpassword123",
      role: "student",
    });
    await loginViaUi(page, "test_student", "testpassword123");

    await expect(page.getByTestId("nav-library")).toHaveCount(0);
    await page.goto("/library");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId("dashboard")).toBeVisible();
  });

  test("admin can upload multiple materials and see them in the library", async ({
    page,
    testing,
  }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");

    const tempDir = path.join(process.cwd(), "e2e", ".tmp");
    const firstFixturePath = path.join(tempDir, "Moonlight-Sonata.pdf");
    const secondFixturePath = path.join(tempDir, "Scale-Patterns.pdf");
    const createdMaterialIds: string[] = [];

    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(firstFixturePath, `%PDF-1.4\n% Test upload fixture ${Date.now()}\n`);
    await fs.writeFile(secondFixturePath, `%PDF-1.4\n% Test upload fixture ${Date.now() + 1}\n`);

    try {
      await page.getByTestId("nav-library").click();
      await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

      await page.getByTestId("upload-material").click();
      const form = page.getByTestId("upload-material-form");
      await expect(form).toBeVisible();

      await form.getByLabel("Files").setInputFiles([firstFixturePath, secondFixturePath]);

      const firstRow = form
        .getByTestId("upload-material-row")
        .filter({ hasText: "Moonlight-Sonata.pdf" });
      const secondRow = form
        .getByTestId("upload-material-row")
        .filter({ hasText: "Scale-Patterns.pdf" });

      await expect(firstRow.getByLabel("Title")).toHaveValue("Moonlight Sonata");
      await expect(secondRow.getByLabel("Title")).toHaveValue("Scale Patterns");

      const responses: any[] = [];
      const uploadResponsesPromise = new Promise<any[]>((resolve) => {
        page.on("response", function handler(response) {
          if (
            response.url().includes("/api/admin/materials/upload") &&
            response.request().method() === "POST"
          ) {
            responses.push(response);
            if (responses.length === 2) {
              page.off("response", handler);
              resolve(responses);
            }
          }
        });
      });
      await form.getByRole("button", { name: "Upload 2 files" }).click();

      const uploadResponses = await uploadResponsesPromise;
      for (const response of uploadResponses) {
        expect(response.ok()).toBe(true);
      }

      const uploadedMaterials = (await Promise.all(
        uploadResponses.map(
          (response) =>
            response.json() as Promise<{
              id: string;
              title: string;
            }>,
        ),
      )) satisfies Array<{ id: string; title: string }>;
      createdMaterialIds.push(...uploadedMaterials.map((material) => material.id));

      await expect(
        page.getByTestId("material-row").filter({ hasText: "Moonlight Sonata" }),
      ).toBeVisible();
      await expect(
        page.getByTestId("material-row").filter({ hasText: "Scale Patterns" }),
      ).toBeVisible();
    } finally {
      // Unmount previews before deleting their backing files so the browser
      // cannot race a late media request against cleanup.
      await page.goto("/dashboard");
      for (const materialId of createdMaterialIds) {
        await page.request.delete(`/api/admin/materials/${materialId}`, {
          headers: { "X-Requested-With": "dfg" },
        });
      }
      await fs.rm(firstFixturePath, { force: true });
      await fs.rm(secondFixturePath, { force: true });
    }
  });

  test("admin upload prefills score titles and keeps manual edits", async ({ page, testing }) => {
    await testing.login();
    await loginViaUi(page, "test_admin", "testpassword123");
    const tempDir = path.join(process.cwd(), "e2e", ".tmp");
    const fallbackFixturePath = path.join(tempDir, "Fresh-Upload.pdf");

    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(fallbackFixturePath, `%PDF-1.4\n% Manual override fixture ${Date.now()}\n`);

    try {
      await page.getByTestId("nav-library").click();
      await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

      await page.getByTestId("upload-material").click();
      const form = page.getByTestId("upload-material-form");
      await expect(form).toBeVisible();

      await form.getByLabel("Files").setInputFiles(notationFixturePath);

      const notationRow = form
        .getByTestId("upload-material-row")
        .filter({ hasText: "fixture-score.musicxml" });

      await expect(notationRow.getByLabel("Title")).toHaveValue("Fixture Score Title");
      await expect(notationRow.getByText("Detected 3 tracks")).toBeVisible();
      await expect(notationRow.getByText("Guitar 1")).toBeVisible();
      await expect(notationRow.getByText("Bass")).toBeVisible();
      await expect(notationRow.getByText("Drums")).toBeVisible();

      await notationRow.getByLabel("Title").fill("Manual Override");
      await form.getByLabel("Files").setInputFiles(fallbackFixturePath);

      const fallbackRow = form
        .getByTestId("upload-material-row")
        .filter({ hasText: "Fresh-Upload.pdf" });

      await expect(notationRow.getByLabel("Title")).toHaveValue("Manual Override");
      await expect(fallbackRow.getByLabel("Title")).toHaveValue("Fresh Upload");
    } finally {
      await fs.rm(fallbackFixturePath, { force: true });
    }
  });
});
