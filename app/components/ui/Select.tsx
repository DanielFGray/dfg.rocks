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
  "data-pwid"?: string;
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
  "data-pwid": pwid,
}: SelectProps) => (
  <AriaSelect
    name={name}
    selectedKey={value ?? null}
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
      data-pwid={pwid}
      className={`flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-primary outline-none transition-colors data-[focused]:border-accent data-[focused]:ring-1 data-[focused]:ring-accent/50 cursor-pointer ${error ? "border-red-500/50" : "border-white/10"}`}
    >
      <SelectValue className="data-[placeholder]:text-muted/50 truncate" />
      <svg
        className="ml-2 h-4 w-4 text-muted shrink-0"
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
    <Popover className="w-[var(--trigger-width)] overflow-auto rounded-lg border border-white/10 bg-card shadow-2xl max-h-60">
      <ListBox className="outline-none p-1">
        {options.map((opt) => (
          <ListBoxItem
            key={opt.value}
            id={opt.value}
            textValue={opt.label}
            className="rounded-md px-3 py-2 text-sm text-primary cursor-pointer outline-none data-[focused]:bg-white/[0.08] data-[selected]:text-accent transition-colors"
          >
            {opt.label}
          </ListBoxItem>
        ))}
      </ListBox>
    </Popover>
    {error ? (
      <Text slot="errorMessage" className="text-sm text-red-400 mt-0.5">
        {error}
      </Text>
    ) : null}
  </AriaSelect>
);
