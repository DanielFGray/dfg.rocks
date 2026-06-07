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
    {...(value !== undefined ? { selectedKey: value || null } : {})}
    isRequired={required}
    isDisabled={disabled}
    isInvalid={!!error}
    onSelectionChange={(key) => onChange?.(String(key))}
    onBlur={onBlur}
    className="gap-1.5 flex flex-col"
  >
    <Label className="text-sm font-medium text-muted dark:text-muted-dark">
      {label}
    </Label>
    <Button
      id={id}
      data-testid={pwid}
      className={`rounded-lg bg-card dark:bg-card-dark px-4 py-3 text-primary dark:text-primary-dark data-focused:border-accent data-focused:ring-accent/50 flex cursor-pointer items-center justify-between border transition-colors outline-hidden data-focused:ring-1 ${error ? "border-red-500/50" : "border-overlay/10 dark:border-overlay-dark/10"}`}
    >
      <SelectValue className="data-placeholder:text-muted/50 dark:data-placeholder:text-muted-dark/50 truncate" />
      <svg
        className="ml-2 h-4 w-4 text-muted dark:text-muted-dark shrink-0"
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
    <Popover className="rounded-lg border-overlay/10 dark:border-overlay-dark/10 bg-card dark:bg-card-dark shadow-2xl max-h-60 w-(--trigger-width) overflow-auto border">
      <ListBox className="p-1 outline-hidden">
        {options.map((opt) => (
          <ListBoxItem
            key={opt.value}
            id={opt.value}
            textValue={opt.label}
            className="rounded-md px-3 py-2 text-sm text-primary dark:text-primary-dark data-focused:bg-overlay/8 dark:data-focused:bg-overlay-dark/8 data-selected:text-accent cursor-pointer transition-colors outline-hidden"
          >
            {opt.label}
          </ListBoxItem>
        ))}
      </ListBox>
    </Popover>
    {error ? (
      <Text
        slot="errorMessage"
        className="text-sm text-red-600 dark:text-red-400 mt-0.5"
      >
        {error}
      </Text>
    ) : null}
  </AriaSelect>
);
