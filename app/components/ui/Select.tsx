import {
  Select as AriaSelect,
  Label,
  Button,
  SelectValue,
  Popover,
  ListBox,
  ListBoxItem,
  Text,
} from "react-aria-components";

type SelectOption = {
  value: string;
  label: string;
};

type SelectProps = {
  id: string;
  name: string;
  label: string;
  options: SelectOption[];
  value?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  "data-testid"?: string;
};

export const Select = ({
  id,
  name,
  label,
  options,
  value,
  required,
  disabled,
  error,
  onChange,
  onBlur,
  "data-testid": pwid,
}: SelectProps) => (
  <AriaSelect
    name={name}
    aria-label={label}
    {...(value !== undefined ? { selectedKey: value || null } : {})}
    isRequired={required}
    isDisabled={disabled}
    isInvalid={!!error}
    onSelectionChange={(key) => onChange?.(String(key))}
    onBlur={onBlur}
    className="flex flex-col gap-1.5"
  >
    <Label className="text-sm font-medium text-muted">{label}</Label>
    <Button
      id={id}
      data-testid={pwid}
      className={`flex cursor-pointer items-center justify-between rounded-lg border bg-card px-4 py-3 text-primary outline-hidden transition-colors data-focused:border-accent data-focused:ring-1 data-focused:ring-accent/50 ${error ? "border-red-500/50" : "border-overlay/10"}`}
    >
      <SelectValue className="truncate data-placeholder:text-muted/50" />
      <svg
        className="ml-2 h-4 w-4 shrink-0 text-muted"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </Button>
    <Popover className="max-h-60 w-(--trigger-width) overflow-auto rounded-lg border border-overlay/10 bg-card shadow-2xl">
      <ListBox className="p-1 outline-hidden">
        {options.map((opt) => (
          <ListBoxItem
            key={opt.value}
            id={opt.value}
            textValue={opt.label}
            data-testid={`select-option-${opt.value}`}
            className="cursor-pointer rounded-md px-3 py-2 text-sm text-primary outline-hidden transition-colors data-focused:bg-overlay/8 data-selected:text-accent"
          >
            {opt.label}
          </ListBoxItem>
        ))}
      </ListBox>
    </Popover>
    {error ? (
      <Text slot="errorMessage" className="mt-0.5 text-sm text-red-600 dark:text-red-400">
        {error}
      </Text>
    ) : null}
  </AriaSelect>
);
