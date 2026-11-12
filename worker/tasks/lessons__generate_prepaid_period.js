// @ts-check
/** @typedef {import("graphile-worker").Task} Task */

/** @typedef {{ studentId: string, billingMonth: string }} GeneratePrepaidPeriodPayload */

/** @type {Task} */
export default async (inPayload, { withPgClient, logger }) => {
  const payload = /** @type {GeneratePrepaidPeriodPayload} */ (inPayload);
  const studentId = payload.studentId;
  const billingMonth = payload.billingMonth;

  if (
    typeof studentId !== "string" ||
    studentId.length === 0 ||
    typeof billingMonth !== "string" ||
    billingMonth.length === 0
  ) {
    throw new Error("lessons__generate_prepaid_period requires studentId and billingMonth");
  }

  let generatedCount = 0;
  try {
    generatedCount = await withPgClient(async (pgClient) => {
      await pgClient.query("begin");
      try {
        const { rows: paymentRows } = await pgClient.query(
          `select id, student_id, billing_month, generation_status
               from app_public.monthly_payments
              where student_id = $1 and billing_month = $2::date
              for update`,
          [studentId, billingMonth],
        );
        /** @type {{ id: string, student_id: string, billing_month: string, generation_status?: string } | null} */
        const payment = paymentRows[0] ?? null;
        if (payment?.generation_status === "generated") {
          await pgClient.query("commit");
          return 0;
        }
        if (payment) {
          await pgClient.query(
            `update app_public.monthly_payments
                set generation_status = 'processing', generation_error = null, generated_at = null
              where id = $1`,
            [payment.id],
          );
        }

        const targetStudentId = studentId;
        const targetBillingMonth = billingMonth;
        const { rows: schedules } = await pgClient.query(
          `select rs.id,
                  rs.day_of_week,
                  rs.local_start_time,
                  rs.timezone,
                  rs.starts_on,
                  rs.ends_on,
                  sr.student_id,
                  sr.lesson_duration_minutes,
                  sr.location_type
             from app_public.recurring_schedules rs
             join app_public.student_rates sr on sr.id = rs.student_rate_id
            where sr.student_id = $1
              and sr.billing_model = 'monthly_prepaid'
              and rs.active
              and rs.starts_on < ($2::date + interval '1 month')::date
              and (rs.ends_on is null or rs.ends_on >= $2::date)
            order by rs.id
            for update of rs, sr`,
          [targetStudentId, targetBillingMonth],
        );

        for (const schedule of schedules) {
          const { rows: lessons } = await pgClient.query(
            `with occurrence_dates as (
               select occurrence_date::date as recurrence_date
                 from generate_series(
                   greatest($2::date, $6::date),
                   least(
                     ($2::date + interval '1 month - 1 day')::date,
                     coalesce($7::date, ($2::date + interval '1 month - 1 day')::date)
                   ),
                   interval '1 day'
                ) occurrence_date
                where extract(isodow from occurrence_date)::smallint = $3::smallint
             ), available_occurrences as (
               select candidate.recurrence_date,
                      (candidate.recurrence_date + $4::time) at time zone $5 as scheduled_at
                 from occurrence_dates candidate
                where not exists (
                  select 1
                    from app_public.lessons existing
                   where existing.status = 'scheduled'
                     and existing.scheduled_at <
                       ((candidate.recurrence_date + $4::time) at time zone $5)
                         + ($8::integer * interval '1 minute')
                     and existing.scheduled_at
                           + (existing.duration_minutes * interval '1 minute')
                         > ((candidate.recurrence_date + $4::time) at time zone $5)
                     and not (
                       existing.recurring_schedule_id = $10::uuid
                       and existing.recurrence_date = candidate.recurrence_date
                     )
                )
             ), inserted as (
               insert into app_public.lessons (
                 student_id, scheduled_at, duration_minutes, location_type,
                 recurring_schedule_id, recurrence_date
               )
               select $1::uuid, scheduled_at, $8::integer, $9::app_public.location_type,
                      $10::uuid, recurrence_date
                 from available_occurrences
               on conflict (recurring_schedule_id, recurrence_date) do nothing
               returning id, recurrence_date
             )
             select id from inserted
             union all
             select l.id
               from app_public.lessons l
               join occurrence_dates od on od.recurrence_date = l.recurrence_date
              where l.recurring_schedule_id = $10::uuid
                and l.gcal_event_id is null
                and l.status = 'scheduled'
                and not exists (
                  select 1 from inserted i where i.recurrence_date = od.recurrence_date
                )`,
            [
              schedule.student_id,
              targetBillingMonth,
              schedule.day_of_week,
              schedule.local_start_time,
              schedule.timezone,
              schedule.starts_on,
              schedule.ends_on,
              schedule.lesson_duration_minutes,
              schedule.location_type,
              schedule.id,
            ],
          );

          generatedCount += lessons.length;
        }

        if (payment) {
          await pgClient.query(
            `update app_public.monthly_payments
                set generation_status = 'generated', generation_error = null, generated_at = now()
              where id = $1`,
            [payment.id],
          );
        }
        await pgClient.query("commit");
        return generatedCount;
      } catch (error) {
        await pgClient.query("rollback");
        throw error;
      }
    });

    logger.info(
      `lessons__generate_prepaid_period: ${studentId} ${billingMonth}, generated ${generatedCount} lessons`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withPgClient((pgClient) =>
      pgClient.query(
        `update app_public.monthly_payments
            set generation_status = 'failed', generation_error = left($3, 4000), generated_at = null
          where student_id = $1 and billing_month = $2::date`,
        [studentId, billingMonth, message],
      ),
    );
    throw error;
  }
};
