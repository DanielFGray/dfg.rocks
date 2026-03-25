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
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  "data-pwid"?: string;
};

export const Select = ({
  id,
  name,
  label,
  options,
  value,
  required,
  disabled,
  onChange,
  "data-pwid": dataCy,
}: SelectProps) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-sm font-medium text-muted">
      {label}
    </label>
    <select
      id={id}
      name={name}
      value={value}
      required={required}
      disabled={disabled}
      onChange={onChange}
      data-pwid={dataCy}
      className="rounded-lg border border-white/10 bg-card px-4 py-3 text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50 cursor-pointer"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);
