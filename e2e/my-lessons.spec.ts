import type { Page, Route } from "@playwright/test";
import { expect, loginViaUi, test } from "./helpers.js";

function futureIso(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(10, 0, 0, 0);
  return date.toISOString();
}

function lessonResponse(route: Route, scheduledAt: string, status: "scheduled" | "cancelled") {
  const pathParts = new URL(route.request().url()).pathname.split("/");
  const lessonId = pathParts.at(-2) ?? "lesson-id";
  const now = new Date().toISOString();

  return {
    id: lessonId,
    student_id: "student-id",
    gcal_event_id: null,
    scheduled_at: scheduledAt,
    duration_minutes: 60,
    location_type: "online",
    status,
    cancellation_reason: status === "cancelled" ? "Schedule conflict" : null,
    cancelled_at: status === "cancelled" ? now : null,
    completed_at: null,
    cancellation_fee_cents: 0,
    remainder_due_cents: 0,
    recurring_schedule_id: null,
    recurrence_date: null,
    created_at: now,
  };
}

type MyLessonsTesting = {
  login(options: { username: string; role: "student"; name: string }): Promise<void>;
  seedLesson(options: { username: string; scheduled_at: string }): Promise<void>;
};

async function seedFutureLesson(page: Page, testing: MyLessonsTesting, username: string) {
  const scheduledAt = futureIso(7);
  await testing.login({ username, role: "student", name: "My Lessons Student" });
  await testing.seedLesson({ username, scheduled_at: scheduledAt });
  await loginViaUi(page, username, "testpassword123");
  await page.goto("/my-lessons");
  await expect(page.getByTestId("my-lessons")).toBeVisible();
  return scheduledAt;
}

test.describe("my lessons cancellation and rescheduling", () => {
  test("previews the cancellation policy and submits a cancellation reason", async ({
    page,
    testing,
  }) => {
    const scheduledAt = await seedFutureLesson(page, testing, "test_my_lesson_cancel");

    await page.route("**/api/my-lessons/*/cancellation-policy", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          billing_model: "single_booking",
          hours_until_lesson: 168,
          is_late: false,
          deposit_outcome: "refunded",
          fee_outcome: "none",
          amount_cents: 4250,
        }),
      }),
    );
    await page.route("**/api/my-lessons/*/cancel", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(lessonResponse(route, scheduledAt, "cancelled")),
      }),
    );

    await page.getByTestId("cancel-my-lesson").click();
    const policy = page.getByTestId("cancellation-policy");
    await expect(policy).toContainText("deposit will be refunded");
    await expect(policy).toContainText("$42.50");

    await page.getByTestId("cancellation-reason").fill("Schedule conflict");
    const cancelRequest = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/cancel"),
    );
    await page.getByTestId("confirm-cancel-my-lesson").click();

    expect((await cancelRequest).postDataJSON()).toEqual({ reason: "Schedule conflict" });
    await expect(page.getByRole("dialog", { name: "Cancel Lesson" })).toBeHidden();
  });

  test("shows the monthly policy and submits a new lesson time", async ({ page, testing }) => {
    await seedFutureLesson(page, testing, "test_my_lesson_reschedule");
    const newLocalTime = "2030-08-20T14:30";

    await page.route("**/api/my-lessons/*/cancellation-policy", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          billing_model: "monthly_prepaid",
          hours_until_lesson: 12,
          is_late: true,
          deposit_outcome: "none",
          fee_outcome: "recorded",
          amount_cents: 5000,
        }),
      }),
    );
    await page.route("**/api/my-lessons/*/reschedule", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          lessonResponse(route, new Date(newLocalTime).toISOString(), "scheduled"),
        ),
      }),
    );

    await page.getByTestId("reschedule-my-lesson").click();
    const policy = page.getByTestId("cancellation-policy");
    await expect(policy).toContainText("monthly cancellation fee will be recorded");
    await expect(policy).toContainText("$50.00");

    await page.getByTestId("new-lesson-date-time").fill(newLocalTime);
    const rescheduleRequest = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/reschedule"),
    );
    await page.getByTestId("confirm-reschedule-my-lesson").click();

    expect((await rescheduleRequest).postDataJSON()).toEqual({
      scheduled_at: new Date(newLocalTime).toISOString(),
    });
    await expect(page.getByRole("dialog", { name: "Reschedule Lesson" })).toBeHidden();
  });
});
