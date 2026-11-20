import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, loginViaUi } from "./helpers.js";

const notationFixturePath = path.join(process.cwd(), "e2e", "fixtures", "fixture-score.musicxml");
const title = "Click Takes Score";

/** Saves a take as whoever the page's session cookie belongs to, and returns the material id. */
async function saveTake(page: Page, materialId: string, onTimePct: number, offsetMs: number) {
  const res = await page.request.post("/api/practice-takes", {
    data: {
      material_id: materialId,
      bpm: 90,
      subdivision: 1,
      notes_heard: 16,
      on_time_pct: onTimePct,
      mean_offset_ms: offsetMs,
      spread_ms: 12,
    },
    headers: { "X-Requested-With": "dfg" },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function assignedMaterialId(page: Page): Promise<string> {
  const res = await page.request.get("/api/assignments");
  expect(res.ok()).toBe(true);
  const rows = (await res.json()) as Array<{ id: string; title: string }>;
  const row = rows.find((r) => r.title === title);
  if (!row) throw new Error("assignment not found");
  return row.id;
}

test.describe("assignment click takes", () => {
  test.beforeEach(async ({ testing }) => {
    await testing.clear();
    await testing.login({ username: "test_takes_parent", role: "parent", name: "Takes Parent" });
    await testing.seedFamily({
      slug: "takes-family",
      name: "Takes Family",
      owner_username: "test_takes_parent",
    });
    await testing.login();
    await testing.seedMaterial({
      title,
      original_filename: "takes.musicxml",
      mime_type: "application/octet-stream",
      source_file_path: notationFixturePath,
      visibility: "course",
    });
    for (const [username, name] of [
      ["test_takes_student", "Takes Student"],
      ["test_takes_sibling", "Takes Sibling"],
    ] as const) {
      await testing.login({ username, role: "student", name });
      await testing.seedFamilyMembership({ username, family_slug: "takes-family" });
      await testing.assignMaterial(username, title, 0);
    }
  });

  test("student sees their own takes with a trend, never a sibling's", async ({ page }) => {
    await loginViaUi(page, "test_takes_sibling", "testpassword123");
    const materialId = await assignedMaterialId(page);
    await saveTake(page, materialId, 41, 30);

    await loginViaUi(page, "test_takes_student", "testpassword123");
    await saveTake(page, materialId, 60, 20);
    await saveTake(page, materialId, 80, -8);

    await page.goto(`/assignments/${materialId}`);
    const takes = page.getByTestId("practice-takes");
    await expect(takes.getByTestId("practice-take")).toHaveCount(2);
    await expect(takes.getByText("60% on time · 20 ms late")).toBeVisible();
    await expect(takes.getByText("80% on time · 8 ms early")).toBeVisible();
    await expect(takes.getByText("41% on time")).toHaveCount(0);
    await expect(takes.getByTestId("practice-takes-trend")).toContainText("% on time: 80%");
  });

  test("teacher sees the student's takes on the assignments page", async ({ page }) => {
    await loginViaUi(page, "test_takes_sibling", "testpassword123");
    const materialId = await assignedMaterialId(page);
    await saveTake(page, materialId, 41, 30);
    await loginViaUi(page, "test_takes_student", "testpassword123");
    await saveTake(page, materialId, 70, 5);

    await loginViaUi(page, "test_admin", "testpassword123");
    await page.goto("/assignments");
    const card = page.getByTestId("assignment-student-card").filter({ hasText: "Takes Student" });
    await expect(card.getByTestId("practice-take")).toHaveCount(1);
    await expect(card.getByText("70% on time · 5 ms late")).toBeVisible();
    await expect(card.getByText("41% on time")).toHaveCount(0);
  });
});
