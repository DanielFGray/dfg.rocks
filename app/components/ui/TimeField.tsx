import { field } from "./field.js";
import {
  TimeField as AriaTimeField,
  DateInput,
  DateSegment,
  Label,
  Text,
} from "react-aria-components";
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
  const f = field({ invalid: !!error });
  return (
    <AriaTimeField
      aria-label={label}
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
      isRequired={isRequired}
      isInvalid={!!error}
      className={f.root({ className })}
      {...rest}
    >
      <Label className={f.label()}>{label}</Label>
      <DateInput data-testid={pwid} className={f.control({ className: "flex" })}>
        {(segment) => (
          <DateSegment
            segment={segment}
            className="rounded-sm px-0.5 tabular-nums outline-hidden data-focused:bg-accent/20 data-focused:text-accent data-placeholder:text-muted/50"
          />
        )}
      </DateInput>
      {error ? (
        <Text slot="errorMessage" className={f.error()}>
          {error}
        </Text>
      ) : null}
    </AriaTimeField>
  );
}
