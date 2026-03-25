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
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  "data-pwid"?: string;
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
  onChange,
  "data-pwid": dataCy,
}: InputProps) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-sm font-medium text-muted">
      {label}
    </label>
    <input
      id={id}
      name={name}
      type={type}
      value={value}
      defaultValue={defaultValue}
      required={required}
      placeholder={placeholder}
      disabled={disabled}
      onChange={onChange}
      data-pwid={dataCy}
      className="rounded-lg border border-white/10 bg-card px-4 py-3 text-primary placeholder:text-muted/50 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50"
    />
  </div>
);
