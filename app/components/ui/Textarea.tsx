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
    value={value}
    defaultValue={defaultValue}
    isRequired={required}
    isDisabled={disabled}
    isInvalid={!!error}
    onChange={onChange}
    className="gap-1.5 flex flex-col"
  >
    <Label className="text-sm font-medium text-muted dark:text-muted-dark">{label}</Label>
    <AriaTextArea
      id={id}
      rows={rows}
      placeholder={placeholder}
      onBlur={onBlur}
      data-testid={pwid}
      className={`rounded-lg bg-card dark:bg-card-dark px-4 py-3 text-primary dark:text-primary-dark placeholder:text-muted/50 dark:placeholder:text-muted-dark/50 data-focused:border-accent data-focused:ring-accent/50 resize-y border transition-colors outline-hidden data-focused:ring-1 ${error ? "border-red-500/50" : "border-overlay/10 dark:border-overlay-dark/10"}`}
    />
    {error ? (
      <Text slot="errorMessage" className="text-sm text-red-600 dark:text-red-400 mt-0.5">
        {error}
      </Text>
    ) : null}
  </TextField>
);
