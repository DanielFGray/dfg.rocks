import {
  Calendar as AriaCalendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  Heading,
  Button,
} from "react-aria-components";
import type { CalendarDate } from "@internationalized/date";

type CalendarProps = {
  value: CalendarDate | null;
  onChange: (value: CalendarDate) => void;
  minValue?: CalendarDate;
  maxValue?: CalendarDate;
};

export function Calendar({ value, onChange, minValue, maxValue }: CalendarProps) {
  return (
    <AriaCalendar
      value={value}
      onChange={onChange}
      minValue={minValue}
      maxValue={maxValue}
      className="w-full"
    >
      <header className="flex items-center justify-between px-1 pb-2">
        <Button
          slot="previous"
          className="cursor-pointer rounded-md p-1 text-muted hover:bg-overlay/5 hover:text-primary dark:text-muted-dark dark:hover:bg-overlay-dark/5 dark:hover:text-primary-dark"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Button>
        <Heading className="text-sm font-semibold text-primary dark:text-primary-dark" />
        <Button
          slot="next"
          className="cursor-pointer rounded-md p-1 text-muted hover:bg-overlay/5 hover:text-primary dark:text-muted-dark dark:hover:bg-overlay-dark/5 dark:hover:text-primary-dark"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Button>
      </header>
      <CalendarGrid className="w-full">
        <CalendarGridHeader>
          {(day) => (
            <CalendarHeaderCell className="pb-1 text-xs font-semibold text-muted dark:text-muted-dark">
              {day}
            </CalendarHeaderCell>
          )}
        </CalendarGridHeader>
        <CalendarGridBody>
          {(date) => (
            <CalendarCell
              date={date}
              className="rounded-lg px-3 py-2 text-sm text-primary hover:bg-overlay/8 data-disabled:text-muted/30 data-outside-month:text-muted/40 data-selected:bg-accent data-selected:text-white data-selected:hover:bg-accent-hover dark:text-primary-dark dark:hover:bg-overlay-dark/8"
            />
          )}
        </CalendarGridBody>
      </CalendarGrid>
    </AriaCalendar>
  );
}
