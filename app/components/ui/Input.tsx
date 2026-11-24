import { field } from "./field.js";
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
  const f = field({ invalid: !!error });
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
      className={f.root()}
    >
      <Label className={f.label()}>{label}</Label>
      <AriaInput
        id={id}
        type={type}
        minLength={minLength}
        placeholder={placeholder}
        readOnly={readOnly}
        autoComplete={autoComplete}
        onBlur={onBlur}
        data-testid={pwid}
        className={f.control()}
      />
      {error ? (
        <Text slot="errorMessage" className={f.error()}>
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
