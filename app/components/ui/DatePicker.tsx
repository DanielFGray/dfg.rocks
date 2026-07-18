import {
  DatePicker as AriaDatePicker,
  DateInput,
  DateSegment,
  Label,
  Group,
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  Popover,
} from "react-aria-components";
import type { DateValue } from "react-aria-components";

type DatePickerProps = {
  label: string;
  value: DateValue | null;
  onChange: (value: DateValue | null) => void;
  isRequired?: boolean;
  isDisabled?: boolean;
  error?: string;
  className?: string;
  "data-testid"?: string;
};

export function DatePicker({
  label,
  value,
  onChange,
  isRequired,
  isDisabled,
  error,
  className,
  "data-testid": pwid,
}: DatePickerProps) {
  return (
    <AriaDatePicker
      value={value}
      onChange={onChange}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isInvalid={!!error}
      className={["flex flex-col gap-1.5", className].filter(Boolean).join(" ")}
    >
      <Label className="text-sm font-medium text-muted dark:text-muted-dark">{label}</Label>
      <Group
        data-testid={pwid}
        className={`flex rounded-lg border bg-card px-4 py-3 text-primary outline-hidden transition-colors data-focused:border-accent data-focused:ring-1 data-focused:ring-accent/50 dark:bg-card-dark dark:text-primary-dark ${
          error ? "border-red-500/50" : "border-overlay/10 dark:border-overlay-dark/10"
        }`}
      >
        <DateInput className="flex flex-1 gap-0.5">
          {(segment) => (
            <DateSegment
              segment={segment}
              className="rounded-sm px-0.5 tabular-nums outline-hidden data-focused:bg-accent/20 data-focused:text-accent data-placeholder:text-muted/50 dark:data-placeholder:text-muted-dark/50"
            />
          )}
        </DateInput>
        <Button
          aria-label="Pick date"
          className="ml-2 cursor-pointer text-muted hover:text-primary dark:text-muted-dark dark:hover:text-primary-dark"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </Button>
      </Group>
      <Popover className="rounded-xl border border-overlay/10 bg-card p-4 shadow-2xl dark:border-overlay-dark/10 dark:bg-card-dark">
        <Calendar>
          <CalendarGrid className="w-full">
            {(date) => (
              <CalendarCell
                date={date}
                className="rounded-lg px-3 py-2 text-sm text-primary hover:bg-overlay/8 data-disabled:text-muted/30 data-outside-month:text-muted/40 data-selected:bg-accent data-selected:text-white data-selected:hover:bg-accent-hover data-unavailable:text-muted/30 dark:text-primary-dark dark:hover:bg-overlay-dark/8"
              />
            )}
          </CalendarGrid>
        </Calendar>
      </Popover>
      {error ? <p className="mt-0.5 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </AriaDatePicker>
  );
}
