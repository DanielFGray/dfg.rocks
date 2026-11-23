import type { ReactNode } from "react";
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";
import { tv, type VariantProps } from "tailwind-variants";

/**
 * A caller's className merges over these classes, so a caller's padding or colour replaces the
 * recipe's own instead of depending on the order of rules in the built stylesheet.
 */
const button = tv({
  base: [
    "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl font-semibold transition-all",
    "data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:transform-none",
    "data-focus-visible:ring-2 data-focus-visible:ring-accent/60 data-focus-visible:ring-offset-2 data-focus-visible:outline-hidden",
  ],
  variants: {
    variant: {
      primary: "bg-accent text-white hover:-translate-y-px hover:bg-accent-hover",
      outline:
        "border border-overlay/20 bg-transparent text-primary hover:border-accent hover:text-accent",
      ghost: "bg-transparent text-muted hover:bg-overlay/5 hover:text-primary",
      danger: "bg-red-600 text-white hover:-translate-y-px hover:bg-red-500",
    },
    size: {
      md: "px-6 py-3 text-sm",
      sm: "px-3 py-1.5 text-xs",
      xs: "px-2 py-1 text-xs",
      icon: "rounded-lg p-1.5",
    },
    /**
     * The text colour of a ghost button that names its action's kind. Plain colours do not
     * change in dark mode, so each tone pairs a dark shade on light pages with a light one in
     * dark mode.
     */
    tone: {
      danger: "text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300",
      success: "text-green-600 hover:text-green-500 dark:text-green-400 dark:hover:text-green-300",
      info: "text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300",
      warning: "text-amber-600 hover:text-amber-500 dark:text-amber-400 dark:hover:text-amber-300",
      note: "text-violet-600 hover:text-violet-500 dark:text-violet-400 dark:hover:text-violet-300",
      accent: "text-accent hover:text-accent-hover",
    },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

type ButtonProps = VariantProps<typeof button> &
  Omit<AriaButtonProps, "children" | "className" | "isDisabled" | "onPress" | "style"> & {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    className?: string;
    "data-testid"?: string;
  };

export const Button = ({
  children,
  type = "button",
  variant,
  size,
  tone,
  disabled,
  onClick,
  className,
  "data-testid": pwid,
  ...rest
}: ButtonProps) => (
  <AriaButton
    type={type}
    isDisabled={disabled}
    onPress={() => onClick?.()}
    data-testid={pwid}
    className={button({ variant, size, tone, className })}
    {...rest}
  >
    {children}
  </AriaButton>
);
