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
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  "data-pwid"?: string;
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
  onChange,
  "data-pwid": dataCy,
}: TextareaProps) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-sm font-medium text-muted">
      {label}
    </label>
    <textarea
      id={id}
      name={name}
      rows={rows}
      value={value}
      defaultValue={defaultValue}
      required={required}
      placeholder={placeholder}
      disabled={disabled}
      onChange={onChange}
      data-pwid={dataCy}
      className="rounded-lg border border-white/10 bg-card px-4 py-3 text-primary placeholder:text-muted/50 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50 resize-y"
    />
  </div>
);
