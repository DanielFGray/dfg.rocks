type TextareaProps = {
  id: string;
  name: string;
  label: string;
  rows?: number;
  value?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  "data-cy"?: string;
};

export const Textarea = ({
  id,
  name,
  label,
  rows = 4,
  value,
  required,
  placeholder,
  disabled,
  "data-cy": dataCy,
}: TextareaProps) => (
  <div class="flex flex-col gap-1.5">
    <label for={id} class="text-sm font-medium text-muted">
      {label}
    </label>
    <textarea
      id={id}
      name={name}
      rows={rows}
      value={value}
      required={required}
      placeholder={placeholder}
      disabled={disabled}
      data-cy={dataCy}
      class="rounded-lg border border-white/10 bg-card px-4 py-3 text-primary placeholder:text-muted/50 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50 resize-y"
    />
  </div>
);
