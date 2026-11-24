import { field } from "./field.js";
import {
  ComboBox as AriaComboBox,
  Label,
  Input,
  Button,
  ListBox,
  ListBoxItem,
  Popover,
  Text,
} from "react-aria-components";

type ComboBoxOption = {
  value: string;
  label: string;
};

type ComboBoxProps = {
  id: string;
  name: string;
  label: string;
  options: ComboBoxOption[];
  value?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  "data-testid"?: string;
};

export const ComboBox = ({
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
  placeholder,
  "data-testid": pwid,
}: ComboBoxProps) => {
  const f = field({ invalid: !!error });
  return (
    <AriaComboBox
      name={name}
      selectedKey={value || null}
      onSelectionChange={(key) => {
        if (key && onChange) onChange(String(key));
      }}
      onBlur={onBlur}
      isRequired={required}
      isDisabled={disabled}
      isInvalid={!!error}
      defaultItems={options}
      allowsCustomValue={false}
      menuTrigger="focus"
      className={f.root()}
    >
      <Label className={f.label()}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          placeholder={placeholder}
          data-testid={pwid}
          className={f.control({ className: "w-full" })}
        />
        <Button
          className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer text-muted hover:text-primary"
          aria-label="Show options"
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
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Button>
      </div>
      <Popover className={f.popover()}>
        <ListBox className={f.listBox()}>
          {(item: ComboBoxOption) => (
            <ListBoxItem id={item.value} textValue={item.label} className={f.option()}>
              {item.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
      {error ? (
        <Text slot="errorMessage" className={f.error()}>
          {error}
        </Text>
      ) : null}
    </AriaComboBox>
  );
};
