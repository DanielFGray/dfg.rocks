import { TimeField as AriaTimeField, DateInput, DateSegment, Label } from "react-aria-components";
import type { TimeValue } from "react-aria-components";

type TimeFieldProps = {
  label: string;
  value: TimeValue | null;
  onChange: (value: TimeValue | null) => void;
  error?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  className?: string;
  "data-testid"?: string;
};

export function TimeField({
  label,
  value,
  onChange,
  error,
  isRequired,
  isDisabled,
  className,
  "data-testid": pwid,
  ...rest
}: TimeFieldProps) {
  return (
    <AriaTimeField
      aria-label={label}
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
      isRequired={isRequired}
      className={["flex flex-col gap-1", className].filter(Boolean).join(" ")}
      {...rest}
    >
      <Label className="text-sm font-medium text-muted dark:text-muted-dark">{label}</Label>
      <DateInput
        data-testid={pwid}
        className="border-border flex rounded-sm border bg-surface px-2 py-1 text-sm text-primary outline-hidden transition-colors data-focused:border-accent data-focused:ring-1 data-focused:ring-accent/50 data-invalid:border-red-500 data-invalid:ring-red-500/50 dark:bg-surface-dark dark:text-primary-dark"
      >
        {(segment) => (
          <DateSegment
            segment={segment}
            className="rounded-sm px-0.5 tabular-nums outline-hidden data-focused:bg-accent/20 data-focused:text-accent data-placeholder:text-muted/50 dark:data-placeholder:text-muted-dark/50"
          />
        )}
      </DateInput>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </AriaTimeField>
  );
}
