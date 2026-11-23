import { TextField, Label, TextArea as AriaTextArea, Text } from "react-aria-components";

type TextareaProps = {
  id: string;
  name: string;
  label: string;
  rows?: number;
  value?: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  "data-testid"?: string;
};

export const Textarea = ({
  id,
  name,
  label,
  rows = 4,
  value,
  defaultValue,
  required,
  placeholder,
  disabled,
  error,
  onChange,
  onBlur,
  "data-testid": pwid,
}: TextareaProps) => (
  <TextField
    name={name}
    aria-label={label}
    value={value}
    defaultValue={defaultValue}
    isRequired={required}
    isDisabled={disabled}
    isInvalid={!!error}
    onChange={onChange}
    className="flex flex-col gap-1.5"
  >
    <Label className="text-sm font-medium text-muted">{label}</Label>
    <AriaTextArea
      id={id}
      rows={rows}
      placeholder={placeholder}
      onBlur={onBlur}
      data-testid={pwid}
      className={`resize-y rounded-lg border bg-card px-4 py-3 text-primary outline-hidden transition-colors placeholder:text-muted/50 data-focused:border-accent data-focused:ring-1 data-focused:ring-accent/50 ${error ? "border-red-500/50" : "border-overlay/10"}`}
    />
    {error ? (
      <Text slot="errorMessage" className="mt-0.5 text-sm text-red-600 dark:text-red-400">
        {error}
      </Text>
    ) : null}
  </TextField>
);
