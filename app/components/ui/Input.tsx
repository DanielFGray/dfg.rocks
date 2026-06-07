import {
  TextField,
  Label,
  Input as AriaInput,
  Text,
} from "react-aria-components";

type InputProps = {
  id: string;
  name: string;
  label: string;
  type?: string;
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

export const Input = ({
  id,
  name,
  label,
  type = "text",
  value,
  defaultValue,
  required,
  placeholder,
  disabled,
  error,
  onChange,
  onBlur,
  "data-testid": pwid,
}: InputProps) => (
  <TextField
    name={name}
    value={value}
    defaultValue={defaultValue}
    isRequired={required}
    isDisabled={disabled}
    isInvalid={!!error}
    onChange={onChange}
    className="flex flex-col gap-1.5"
  >
    <Label className="text-sm font-medium text-muted dark:text-muted-dark">
      {label}
    </Label>
    <AriaInput
      id={id}
      type={type}
      placeholder={placeholder}
      onBlur={onBlur}
      data-testid={pwid}
      className={`rounded-lg border bg-card px-4 py-3 text-primary outline-hidden transition-colors placeholder:text-muted/50 data-focused:border-accent data-focused:ring-1 data-focused:ring-accent/50 dark:bg-card-dark dark:text-primary-dark dark:placeholder:text-muted-dark/50 ${error ? "border-red-500/50" : "border-overlay/10 dark:border-overlay-dark/10"}`}
    />
    {error ? (
      <Text
        slot="errorMessage"
        className="mt-0.5 text-sm text-red-600 dark:text-red-400"
      >
        {error}
      </Text>
    ) : null}
  </TextField>
);
