import { useEffect, useState } from "react";
import { TextField, Label, Input as AriaInput, Text } from "react-aria-components";

type InputProps = {
  id: string;
  name: string;
  label: string;
  type?: string;
  value?: string;
  defaultValue?: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  autoComplete?: string;
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
  minLength,
  placeholder,
  disabled,
  readOnly,
  autoComplete,
  error,
  onChange,
  onBlur,
  "data-testid": pwid,
}: InputProps) => {
  const typed = usePreHydrationValue(id);
  // A controlled caller owns the state, so hand the typed text to it.
  useEffect(() => {
    if (typed !== undefined && value !== undefined && typed !== value) onChange?.(typed);
  }, []);
  return (
    <TextField
      name={name}
      aria-label={label}
      value={value}
      defaultValue={typed ?? defaultValue}
      isRequired={required}
      isDisabled={disabled}
      isInvalid={!!error}
      onChange={onChange}
      className="flex flex-col gap-1.5"
    >
      <Label className="text-sm font-medium text-muted dark:text-muted-dark">{label}</Label>
      <AriaInput
        id={id}
        type={type}
        minLength={minLength}
        placeholder={placeholder}
        readOnly={readOnly}
        autoComplete={autoComplete}
        onBlur={onBlur}
        data-testid={pwid}
        className={`rounded-lg border bg-card px-4 py-3 text-primary outline-hidden transition-colors placeholder:text-muted/50 data-focused:border-accent data-focused:ring-1 data-focused:ring-accent/50 dark:bg-card-dark dark:text-primary-dark dark:placeholder:text-muted-dark/50 ${error ? "border-red-500/50" : "border-overlay/10 dark:border-overlay-dark/10"}`}
      />
      {error ? (
        <Text slot="errorMessage" className="mt-0.5 text-sm text-red-600 dark:text-red-400">
          {error}
        </Text>
      ) : null}
    </TextField>
  );
};

/**
 * Reads what the user typed into the server-rendered input before hydration.
 * React Aria always controls the input, so hydration would overwrite that text
 * with the initial state. This must run during the first render, while the DOM
 * still holds the typed text; on a client-side mount no element with the id
 * exists yet and it returns undefined.
 */
function usePreHydrationValue(id: string): string | undefined {
  const [typed] = useState(() => {
    if (typeof document === "undefined") return undefined;
    const element = document.getElementById(id);
    return element instanceof HTMLInputElement && element.value ? element.value : undefined;
  });
  return typed;
}
