import type { VChild } from "fibrae/shared";

type ButtonProps = {
  children: VChild;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "outline" | "ghost";
  disabled?: boolean;
  onclick?: (e: Event) => void;
  class?: string;
  "data-cy"?: string;
};

const variants = {
  primary:
    "bg-accent text-white hover:bg-accent-hover hover:-translate-y-px",
  outline:
    "bg-transparent border border-white/20 text-primary hover:border-accent hover:text-accent",
  ghost:
    "bg-transparent text-muted hover:text-primary hover:bg-white/5",
};

export const Button = ({
  children,
  type = "button",
  variant = "primary",
  disabled,
  onclick,
  class: className,
  "data-cy": dataCy,
}: ButtonProps) => (
  <button
    type={type}
    disabled={disabled}
    onclick={onclick}
    data-cy={dataCy}
    class={[
      "inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-all cursor-pointer",
      "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none",
      variants[variant],
      className,
    ]
      .filter(Boolean)
      .join(" ")}
  >
    {children}
  </button>
);
