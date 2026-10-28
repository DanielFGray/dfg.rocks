// @ts-check
/** @typedef {import("graphile-worker").Task} Task */

/**
 * Daily worker: issues bills for the current America/Chicago calendar month.
 * Idempotent — the DB function checks for existing billing runs.
 * Due date is the 5th of the billing month.
 */
/** @type {Task} */
export default async (_payload, { withPgClient, logger }) => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
  });
  const formatted = formatter.format(now);
  const [year, month] = formatted.split("-");

  // Current calendar month
  const targetMonth = `${year}-${month}-01`;

  logger.info(`bills__issue_monthly: processing billing month ${targetMonth}`);

  try {
    const { rows } = await withPgClient((pgClient) =>
      pgClient.query(
        `select app_public.issue_monthly_bills_for_month($1::date) as result`,
        [targetMonth],
      ),
    );

    const result = rows[0]?.result;
    if (!result) {
      throw new Error("issue_monthly_bills_for_month returned no result");
    }

    logger.info(`bills__issue_monthly: result ${JSON.stringify(result)}`);

    if (result.errors && result.errors > 0) {
      logger.warn(
        `bills__issue_monthly: ${result.errors} error(s) during billing`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`bills__issue_monthly failed: ${message}`);
    throw error;
  }
};
