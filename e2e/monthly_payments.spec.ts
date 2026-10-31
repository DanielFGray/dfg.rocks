import { test, expect } from "./helpers.js";

const adminHeaders = { "Content-Type": "application/json", "X-Requested-With": "dfg" };

test.describe("monthly payments", () => {
  test("admin records a cash payment for an unpaid student", async ({ page, testing }) => {
    await testing.login({
      username: "monthly_student",
      role: "student",
      name: "Monthly Student",
      email: "monthly@test.local",
    });
    await testing.login();
    await page.goto("/dashboard");

    const students = await page.request.get("/api/admin/students", { headers: adminHeaders });
    expect(students.ok()).toBe(true);
    const student = ((await students.json()) as Array<{ id: string; username: string }>).find(
      (s) => s.username === "monthly_student",
    );
    if (!student) throw new Error("Expected the seeded student");

    const rate = await page.request.post("/api/admin/student-rates", {
      headers: adminHeaders,
      data: {
        student_id: student.id,
        rate_cents: 18000,
        lesson_duration_minutes: 60,
        location_type: "studio",
        billing_model: "monthly_prepaid",
      },
    });
    expect(rate.ok(), await rate.text()).toBe(true);
    const month = new Date().toISOString().slice(0, 7);
    const schedule = await page.request.post(
      `/api/admin/students/${student.id}/recurring-schedules`,
      {
        headers: adminHeaders,
        data: {
          student_rate_id: ((await rate.json()) as { id: string }).id,
          day_of_week: 2,
          local_start_time: "16:30",
          timezone: "America/Chicago",
          starts_on: `${month}-01`,
          ends_on: null,
          active: true,
        },
      },
    );
    expect(schedule.ok(), await schedule.text()).toBe(true);

    await page.getByTestId("nav-payments").click();
    const row = page.getByTestId("monthly-payment-row").filter({ hasText: "Monthly Student" });
    await expect(row).toContainText("Not paid");

    await row.getByRole("button", { name: "Record payment" }).click();
    await page.getByTestId("payment-amount").fill("180");
    await page
      .getByTestId("monthly-payment-form")
      .getByRole("button", { name: "Record payment" })
      .click();

    await expect(row).toContainText("Paid");
    await expect(row).not.toContainText("Not paid");
    await expect(row).toContainText("$180.00");
  });

  test("admin records cash for an unpaid single lesson", async ({ page, testing }) => {
    await testing.login({
      username: "single_student",
      role: "student",
      name: "Single Student",
      email: "single@test.local",
    });
    await testing.login();
    await page.goto("/dashboard");

    const students = await page.request.get("/api/admin/students", { headers: adminHeaders });
    expect(students.ok()).toBe(true);
    const student = ((await students.json()) as Array<{ id: string; username: string }>).find(
      (s) => s.username === "single_student",
    );
    if (!student) throw new Error("Expected the seeded student");

    const rate = await page.request.post("/api/admin/student-rates", {
      headers: adminHeaders,
      data: {
        student_id: student.id,
        rate_cents: 7500,
        lesson_duration_minutes: 60,
        location_type: "studio",
        billing_model: "single_booking",
      },
    });
    expect(rate.ok(), await rate.text()).toBe(true);
    const month = new Date().toISOString().slice(0, 7);
    const lesson = await page.request.post("/api/admin/lessons", {
      headers: adminHeaders,
      data: {
        student_id: student.id,
        scheduled_at: `${month}-15T18:00:00.000Z`,
        duration_minutes: 60,
        location_type: "studio",
      },
    });
    expect(lesson.ok(), await lesson.text()).toBe(true);

    await page.getByTestId("nav-payments").click();
    const row = page.getByTestId("lesson-bill-row").filter({ hasText: "Single Student" });
    await expect(row).toContainText("Not paid");
    await expect(row).toContainText("$75.00");

    await row.getByRole("button", { name: "Record cash" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Record cash" }).click();

    await expect(row).toContainText("Paid");
    await expect(row).not.toContainText("Not paid");
    await expect(row.getByRole("button", { name: "Record cash" })).toHaveCount(0);
  });
});
