import { field } from "./field.js";
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
}: SelectProps) => {
  const f = field({ invalid: !!error });
  return (
    <AriaSelect
      name={name}
      aria-label={label}
      {...(value !== undefined ? { selectedKey: value || null } : {})}
      isRequired={required}
      isDisabled={disabled}
      isInvalid={!!error}
      onSelectionChange={(key) => onChange?.(String(key))}
      onBlur={onBlur}
      className={f.root()}
    >
      <Label className={f.label()}>{label}</Label>
      <Button
        id={id}
        data-testid={pwid}
        className={f.control({ className: "flex cursor-pointer items-center justify-between" })}
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
      <Popover className={f.popover()}>
        <ListBox className={f.listBox()}>
          {options.map((opt) => (
            <ListBoxItem
              key={opt.value}
              id={opt.value}
              textValue={opt.label}
              data-testid={`select-option-${opt.value}`}
              className={f.option()}
            >
              {opt.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
      {error ? (
        <Text slot="errorMessage" className={f.error()}>
          {error}
        </Text>
      ) : null}
    </AriaSelect>
  );
};
