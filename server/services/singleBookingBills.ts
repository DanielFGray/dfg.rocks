import type { Database } from "../db.js";

/**
 * Bills a lesson when the student's rate for its location is single-booking,
 * and returns that bill's id (null for any other billing model). Idempotent.
 */
export const singleBookingObligation = (db: Database, lessonId: string) =>
  db.selectNoFrom((eb) =>
    eb
      .fn<string | null>("app_public.create_single_booking_obligation", [eb.val(lessonId)])
      .as("bill_id"),
  );

/**
 * Cancels a lesson's open single-booking bill. A captured deposit becomes a
 * credit for the payer.
 */
export const settleSingleBookingCancellation = (
  db: Database,
  lessonId: string,
  capturedDepositCents = 0,
) =>
  db.selectNoFrom((eb) =>
    eb
      .fn<unknown>("app_public.settle_single_booking_cancellation", [
        eb.val(lessonId),
        eb.val(capturedDepositCents),
      ])
      .as("settled"),
  );
