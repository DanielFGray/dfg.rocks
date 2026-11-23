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
}: ComboBoxProps) => (
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
    className="flex flex-col gap-1.5"
  >
    <Label className="text-sm font-medium text-muted">{label}</Label>
    <div className="relative">
      <Input
        id={id}
        placeholder={placeholder}
        data-testid={pwid}
        className={`w-full rounded-lg border bg-card px-4 py-3 text-primary outline-hidden transition-colors placeholder:text-muted/50 data-focused:border-accent data-focused:ring-1 data-focused:ring-accent/50 ${
          error ? "border-red-500/50" : "border-overlay/10"
        }`}
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
    <Popover className="max-h-60 w-(--trigger-width) overflow-auto rounded-lg border border-overlay/10 bg-card shadow-2xl">
      <ListBox className="p-1 outline-hidden">
        {(item: ComboBoxOption) => (
          <ListBoxItem
            id={item.value}
            textValue={item.label}
            className="cursor-pointer rounded-md px-3 py-2 text-sm text-primary outline-hidden transition-colors data-focused:bg-overlay/8 data-selected:text-accent"
          >
            {item.label}
          </ListBoxItem>
        )}
      </ListBox>
    </Popover>
    {error ? (
      <Text slot="errorMessage" className="mt-0.5 text-sm text-red-600 dark:text-red-400">
        {error}
      </Text>
    ) : null}
  </AriaComboBox>
);
