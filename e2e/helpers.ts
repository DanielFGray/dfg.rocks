import { test as base, expect, type Page } from "@playwright/test";
import type { UserRole } from "../shared/schemas.js";

const api_url = "http://localhost:3001";

type TestUser = {
  id: string;
  username: string;
  email: string;
  name: string;
  role: string;
};

type TestCourse = {
  id: string;
  title: string;
  instrument: string;
  description: string;
  modules: Array<{
    id: string;
    title: string;
    description: string | null;
    sort_order: number;
  }>;
};

type TestingApi = {
  login(opts?: {
    username?: string;
    password?: string;
    role?: UserRole;
    name?: string;
    email?: string;
  }): Promise<TestUser>;
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
  }): Promise<TestCourse>;
  enroll(student_id: string, course_id: string): Promise<void>;
};

/** Playwright equivalent of getCy — finds elements by data-cy attribute */
const getCy = (page: Page, name: string) => page.locator(`[data-cy=${name}]`);

/** Login through the UI (client-side routing) */
const loginViaUi = async (page: Page, username: string, password: string) => {
  await page.goto("/login");
  await getCy(page, "login-id").fill(username);
  await getCy(page, "login-password").fill(password);
  await getCy(page, "login-submit").click();
  await expect(getCy(page, "dashboard")).toBeVisible();
};

export const test = base.extend<{ testing: TestingApi }>({
  testing: async ({ page }, use) => {
    const testing: TestingApi = {
      async login(opts = {}) {
        const res = await page.request.post(`${api_url}/api/testing/login`, {
          data: {
            username: "test_admin",
            role: "admin",
            ...opts,
          },
        });
        expect(res.ok(), `testing/login failed: ${await res.text()}`).toBe(true);
        return res.json();
      },

      async clear() {
        const res = await page.request.post(`${api_url}/api/testing/clear`);
        expect(res.ok(), `testing/clear failed: ${await res.text()}`).toBe(true);
      },

      async seedCourse(data) {
        const res = await page.request.post(`${api_url}/api/testing/seed-course`, {
          data,
        });
        expect(res.ok(), `testing/seed-course failed: ${await res.text()}`).toBe(true);
        return res.json();
      },

      async enroll(student_id, course_id) {
        const res = await page.request.post(`${api_url}/api/testing/enroll`, {
          data: { student_id, course_id },
        });
        expect(res.ok(), `testing/enroll failed: ${await res.text()}`).toBe(true);
      },
    };

    await testing.clear();
    await use(testing);
  },
});

export { expect, getCy, loginViaUi };
