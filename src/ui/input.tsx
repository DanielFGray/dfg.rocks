type InputProps = {
  id: string;
  name: string;
  label: string;
  type?: string;
  value?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  oninput?: (e: Event) => void;
  "data-cy"?: string;
};

export const Input = ({
  id,
  name,
  label,
  type = "text",
  value,
  required,
  placeholder,
  disabled,
  oninput,
  "data-cy": dataCy,
}: InputProps) => (
  <div class="flex flex-col gap-1.5">
    <label for={id} class="text-sm font-medium text-muted">
      {label}
    </label>
    <input
      id={id}
      name={name}
      type={type}
      value={value}
      required={required}
      placeholder={placeholder}
      disabled={disabled}
      oninput={oninput}
      data-cy={dataCy}
      class="rounded-lg border border-white/10 bg-card px-4 py-3 text-primary placeholder:text-muted/50 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50"
    />
  </div>
);
