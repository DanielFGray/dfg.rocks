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
  "data-cy"?: string;
};

export const Select = ({
  id,
  name,
  label,
  options,
  value,
  required,
  disabled,
  "data-cy": dataCy,
}: SelectProps) => (
  <div class="flex flex-col gap-1.5">
    <label for={id} class="text-sm font-medium text-muted">
      {label}
    </label>
    <select
      id={id}
      name={name}
      value={value}
      required={required}
      disabled={disabled}
      data-cy={dataCy}
      class="rounded-lg border border-white/10 bg-card px-4 py-3 text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50 cursor-pointer"
    >
      {options.map((opt) => (
        <option value={opt.value} selected={opt.value === value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);
