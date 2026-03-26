import type { ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";

type ButtonProps = {
  children: ReactNode;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "outline" | "ghost" | "danger";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  "data-pwid"?: string;
  [key: string]: unknown;
};

const variants = {
  primary:
    "bg-accent text-white hover:bg-accent-hover hover:-translate-y-px",
  outline:
    "bg-transparent border border-white/20 text-primary hover:border-accent hover:text-accent",
  ghost:
    "bg-transparent text-muted hover:text-primary hover:bg-white/5",
  danger:
    "bg-red-600 text-white hover:bg-red-500 hover:-translate-y-px",
};

export const Button = ({
  children,
  type = "button",
  variant = "primary",
  disabled,
  onClick,
  className,
  "data-pwid": pwid,
  ...rest
}: ButtonProps) => (
  <AriaButton
    type={type}
    isDisabled={disabled}
    onPress={() => onClick?.()}
    data-pwid={pwid}
    className={[
      "inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-all cursor-pointer",
      "data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:hover:transform-none",
      "data-[focus-visible]:outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-accent/60 data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-offset-bg",
      variants[variant],
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    {...rest}
  >
    {children}
  </AriaButton>
);
