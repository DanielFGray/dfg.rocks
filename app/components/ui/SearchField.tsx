import { field } from "./field.js";
import { SearchField as AriaSearchField, Label, Input, Button } from "react-aria-components";

type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  isDisabled?: boolean;
  className?: string;
  "data-testid"?: string;
};

const f = field();

export const SearchField = ({
  value,
  onChange,
  label,
  placeholder = "Search...",
  isDisabled,
  className,
  "data-testid": pwid,
}: SearchFieldProps) => (
  <AriaSearchField
    value={value}
    onChange={onChange}
    isDisabled={isDisabled}
    aria-label={label ? undefined : placeholder}
    className={f.root({ className })}
  >
    {label ? <Label className={f.label()}>{label}</Label> : null}
    <div className="relative">
      <svg
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <Input
        id={pwid}
        placeholder={placeholder}
        data-testid={pwid}
        className={f.control({ className: "w-full px-10" })}
      />
      {value ? (
        <Button
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer text-muted hover:text-primary"
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </Button>
      ) : null}
    </div>
  </AriaSearchField>
);
