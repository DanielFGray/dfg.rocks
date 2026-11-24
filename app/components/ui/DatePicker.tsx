import { field } from "./field.js";
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
  const f = field({ invalid: !!error });
  return (
    <AriaDatePicker
      value={value}
      onChange={onChange}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isInvalid={!!error}
      className={f.root({ className })}
    >
      <Label className={f.label()}>{label}</Label>
      <Group data-testid={pwid} className={f.control({ className: "flex" })}>
        <DateInput className="flex flex-1 gap-0.5">
          {(segment) => (
            <DateSegment
              segment={segment}
              className="rounded-sm px-0.5 tabular-nums outline-hidden data-focused:bg-accent/20 data-focused:text-accent data-placeholder:text-muted/50"
            />
          )}
        </DateInput>
        <Button
          aria-label="Pick date"
          className="ml-2 cursor-pointer text-muted hover:text-primary"
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
      <Popover className="rounded-xl border border-overlay/10 bg-card p-4 shadow-2xl">
        <Calendar>
          <CalendarGrid className="w-full">
            {(date) => (
              <CalendarCell
                date={date}
                className="rounded-lg px-3 py-2 text-sm text-primary hover:bg-overlay/8 data-disabled:text-muted/30 data-outside-month:text-muted/40 data-selected:bg-accent data-selected:text-white data-selected:hover:bg-accent-hover data-unavailable:text-muted/30"
              />
            )}
          </CalendarGrid>
        </Calendar>
      </Popover>
      {error ? <p className={f.error()}>{error}</p> : null}
    </AriaDatePicker>
  );
}
