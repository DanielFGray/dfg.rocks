import { field } from "./field.js";
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
}: TextareaProps) => {
  const f = field({ invalid: !!error });
  return (
    <TextField
      name={name}
      aria-label={label}
      value={value}
      defaultValue={defaultValue}
      isRequired={required}
      isDisabled={disabled}
      isInvalid={!!error}
      onChange={onChange}
      className={f.root()}
    >
      <Label className={f.label()}>{label}</Label>
      <AriaTextArea
        id={id}
        rows={rows}
        placeholder={placeholder}
        onBlur={onBlur}
        data-testid={pwid}
        className={f.control({ className: "resize-y" })}
      />
      {error ? (
        <Text slot="errorMessage" className={f.error()}>
          {error}
        </Text>
      ) : null}
    </TextField>
  );
};
