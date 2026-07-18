import { fromAbsolute, startOfWeek, toCalendarDate } from "@internationalized/date";

export const BUSINESS_TIME_ZONE = "America/Chicago";

export interface DateRange {
  /** Inclusive lower UTC instant. */
  from: Date;
  /** Exclusive upper UTC instant. */
  to: Date;
}

function localDateAt(instant: Date) {
  return toCalendarDate(fromAbsolute(instant.getTime(), BUSINESS_TIME_ZONE));
}

function rangeForLocalDates(from: ReturnType<typeof localDateAt>, days: number): DateRange {
  return {
    from: from.toDate(BUSINESS_TIME_ZONE),
    to: from.add({ days }).toDate(BUSINESS_TIME_ZONE),
  };
}

/** Returns the Galveston local day containing `instant` as a half-open UTC instant range. */
export function todayRange(instant: Date = new Date()): DateRange {
  return rangeForLocalDates(localDateAt(instant), 1);
}

/** Returns the Galveston Monday-through-Sunday week containing `instant`. */
export function weekRange(instant: Date = new Date()): DateRange {
  const monday = startOfWeek(localDateAt(instant), "en-US", "mon");
  return rangeForLocalDates(monday, 7);
}
