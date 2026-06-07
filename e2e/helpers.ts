import { test as base, expect, type Page } from "@playwright/test";
import type { UserRole } from "../shared/schemas.js";

const vitePort = process.env.PLAYWRIGHT_VITE_PORT || process.env.VITE_PORT || "4174";
const api_url = process.env.API_URL || `http://127.0.0.1:${vitePort}`;

type TestingApi = {
  login(opts?: {
    username?: string;
    password?: string;
    role?: UserRole;
    name?: string;
    email?: string;
  }): Promise<void>;
  clear(): Promise<void>;
  seedCourse(data: {
    title: string;
    instrument: string;
    description?: string;
    modules?: Array<{
      title: string;
      description?: string;
      sort_order?: number;
    }>;
  }): Promise<void>;
  seedMaterial(data: {
    title: string;
    original_filename?: string;
    mime_type?: string;
    file_size?: number;
    is_global?: boolean;
    source_file_path?: string;
  }): Promise<void>;
  assignMaterial(
    username: string,
    materialTitle: string,
    assignedTrackIndex?: number,
  ): Promise<void>;
  enroll(username: string, courseTitle: string): Promise<void>;
  seedFamily(data?: { name?: string; slug?: string; owner_username?: string }): Promise<void>;
  seedFamilyMembership(data: {
    username: string;
    family_slug: string;
    is_owner?: boolean;
    is_billing_contact?: boolean;
  }): Promise<void>;
  seedInvitation(data: {
    email: string;
    family_slug?: string;
    expires_at?: string;
  }): Promise<string>;
  seedDeleteAccountLink(data: { username: string }): Promise<string>;
  seedLesson(data: {
    username: string;
    scheduled_at?: string;
    duration_minutes?: number;
    location_type?: string;
    status?: string;
  }): Promise<void>;
  setTestimonialReminder(data: {
    username: string;
    prompt_enabled?: boolean;
    next_prompt_at?: string;
  }): Promise<void>;
};

/** Login through the UI (client-side routing) */
const loginViaUi = async (page: Page, username: string, password: string) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("login-id").fill(username);
    await page.getByTestId("login-password").fill(password);

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

    expect(loginResponse.ok(), await loginResponse.text()).toBe(true);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 });
    return;
  }
};

const logoutViaUi = async (page: Page) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const logoutButton = page.locator('[data-testid="logout"]:visible').first();
  await expect(logoutButton).toBeVisible();
  await logoutButton.click();
};

export const test = base.extend<{ testing: TestingApi }>({
  testing: async ({ page }, use) => {
    function qs(params: Record<string, string | undefined>) {
      const s = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) s.set(k, v);
      }
      return s.toString();
    }

    async function get(path: string, params: Record<string, string | undefined> = {}) {
      const q = qs(params);
      const url = `${api_url}/api/testing/${path}${q ? `?${q}` : ""}`;
      const res = await page.request.get(url);
      expect(res.ok(), `testing/${path} failed: ${await res.text()}`).toBe(true);
      return res;
    }

    const testing: TestingApi = {
      async login(opts = {}) {
        await get("login", { username: "test_admin", role: "admin", ...opts });
      },

      async clear() {
        await get("clear");
      },

      async seedCourse(data) {
        const res = await page.request.post(`${api_url}/api/testing/seed-course`, {
          data,
        });
        expect(res.ok(), `testing/seed-course failed: ${await res.text()}`).toBe(true);
      },

      async seedMaterial(data) {
        const res = await page.request.post(`${api_url}/api/testing/seed-material`, {
          data,
        });
        expect(res.ok(), `testing/seed-material failed: ${await res.text()}`).toBe(true);
      },

      async enroll(username, courseTitle) {
        await get("enroll", { username, course_title: courseTitle });
      },

      async assignMaterial(username, materialTitle, assignedTrackIndex) {
        await get("assign-material", {
          username,
          material_title: materialTitle,
          assigned_track_index: assignedTrackIndex?.toString(),
        });
      },

      async seedFamily(data = {}) {
        await get("seed-family", data);
      },

      async seedFamilyMembership(data) {
        await get("seed-family-membership", {
          username: data.username,
          family_slug: data.family_slug,
          is_owner: data.is_owner?.toString(),
          is_billing_contact: data.is_billing_contact?.toString(),
        });
      },

      async seedInvitation(data) {
        const res = await get("seed-invitation", data);
        return res.url();
      },

      async seedDeleteAccountLink(data) {
        const res = await get("seed-delete-account", { username: data.username });
        return res.url();
      },

      async seedLesson(data) {
        await get("seed-lesson", {
          ...data,
          duration_minutes: data.duration_minutes?.toString(),
        });
      },

      async setTestimonialReminder(data) {
        await get("testimonial-reminder", {
          username: data.username,
          prompt_enabled: data.prompt_enabled?.toString(),
          next_prompt_at: data.next_prompt_at,
        });
      },
    };

    await testing.clear();
    await use(testing);
  },
});

export { expect, loginViaUi, logoutViaUi };
