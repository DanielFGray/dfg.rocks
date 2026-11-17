import { test as base, expect, type ConsoleMessage, type Page } from "@playwright/test";
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
  seedSubscription(data: {
    username: string;
    plan: "monthly" | "annual";
    status?: string;
    periodEndInDays?: number;
    cancelAtPeriodEnd?: boolean;
  }): Promise<void>;
  seedInvitation(data: {
    email: string;
    family_slug?: string;
    invited_role?: string;
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
  // `testing.login()` seeds users by issuing a real session. UI-login tests
  // must start without that fixture session or route/auth requests can race.
  await page.context().clearCookies({ name: "session" });
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  const loginId = page.getByTestId("login-id");
  const loginPassword = page.getByTestId("login-password");
  await loginId.fill(username);
  await expect(loginId).toHaveValue(username);
  await loginPassword.fill(password);
  await expect(loginPassword).toHaveValue(password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 });
};

const logoutViaUi = async (page: Page) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const logoutButton = page.locator('[data-testid="logout"]:visible').first();
  await expect(logoutButton).toBeVisible();
  await logoutButton.click();
};

const regressionWarningPatterns = [
  /hydration failed/i,
  /PressResponder/i,
  /Pressable child/i,
  /do not provide a visible label/i,
];

export const test = base.extend<{
  testing: TestingApi;
  browserErrorGuard: void;
  /** A test that visits a page which answers 404 on purpose, such as a missing course. */
  expectMissingPages: boolean;
}>({
  expectMissingPages: [false, { option: true }],
  browserErrorGuard: [
    async ({ page, expectMissingPages }, use) => {
      const browserErrors: string[] = [];
      const handleConsole = (message: ConsoleMessage) => {
        const type = message.type();
        const text = message.text();
        if (
          type === "error" ||
          (type === "warning" && regressionWarningPatterns.some((pattern) => pattern.test(text)))
        ) {
          const { url, lineNumber, columnNumber } = message.location();
          // Chromium's built-in PDF viewer, which runs in the PDF preview iframe
          // (MaterialPreview), intermittently fails to load
          // chrome://resources/css/text_defaults_md.css. These URLs belong to
          // Chromium's own pages; no app or test code can cause or fix them.
          if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return;
          // A page that answers 404 for a missing record is logged by the browser at the page's own
          // URL. Only a test that asks for a missing page may see that one; a missing script or image
          // still fails.
          if (expectMissingPages && text.includes("status of 404") && url === page.url()) return;
          const source = url ? ` (${url}:${lineNumber}:${columnNumber})` : "";
          browserErrors.push(`console.${type}: ${text}${source}`);
        }
      };
      const handlePageError = (error: Error) => {
        browserErrors.push(`pageerror: ${error.stack ?? error.message}`);
      };

      page.on("console", handleConsole);
      page.on("pageerror", handlePageError);

      await use();

      page.off("console", handleConsole);
      page.off("pageerror", handlePageError);
      expect(browserErrors, `Unexpected browser errors:\n${browserErrors.join("\n\n")}`).toEqual(
        [],
      );
    },
    { auto: true },
  ],
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
      const res = await page.request.get(url, { maxRedirects: 0 });
      const succeeded = res.ok() || (res.status() >= 300 && res.status() < 400);
      if (!succeeded) {
        expect(succeeded, `testing/${path} failed: ${await res.text()}`).toBe(true);
      }
      return res;
    }

    function redirectUrl(res: Awaited<ReturnType<typeof get>>): string {
      const location = res.headers()["location"];
      expect(location, "testing endpoint did not return a redirect location").toBeTruthy();
      return new URL(location!, api_url).toString();
    }

    const testing: TestingApi = {
      async login(opts = {}) {
        const q = qs({ username: "test_admin", role: "admin", ...opts });
        const res = await fetch(`${api_url}/api/testing/login?${q}`, { redirect: "manual" });
        const succeeded = res.ok || (res.status >= 300 && res.status < 400);
        if (!succeeded) {
          throw new Error(`testing/login failed: ${await res.text()}`);
        }

        const sessionCookie = res.headers
          .get("set-cookie")
          ?.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
        if (!sessionCookie) throw new Error("testing/login did not return a session cookie");
        await page.context().addCookies([{ name: "session", value: sessionCookie, url: api_url }]);
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

      async seedSubscription(data) {
        await get("seed-subscription", {
          username: data.username,
          plan: data.plan,
          status: data.status,
          period_end_days: data.periodEndInDays?.toString(),
          cancel_at_period_end: data.cancelAtPeriodEnd?.toString(),
        });
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
        return redirectUrl(res);
      },

      async seedDeleteAccountLink(data) {
        const res = await get("seed-delete-account", { username: data.username });
        return redirectUrl(res);
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
