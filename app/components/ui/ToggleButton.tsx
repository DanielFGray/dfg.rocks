import type { ReactNode } from "react";
import { ToggleButton as AriaToggleButton } from "react-aria-components";

type ToggleButtonProps = {
  children: ReactNode;
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  isDisabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
};

export const ToggleButton = ({
  children,
  isSelected,
  onChange,
  isDisabled,
  className,
  "aria-label": ariaLabel,
  "data-testid": pwid,
}: ToggleButtonProps) => (
  <AriaToggleButton
    isSelected={isSelected}
    onChange={onChange}
    isDisabled={isDisabled}
    aria-label={ariaLabel}
    data-testid={pwid}
    className={[
      "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all cursor-pointer",
      "data-disabled:opacity-50 data-disabled:cursor-not-allowed",
      "data-focus-visible:outline-hidden data-focus-visible:ring-2 data-focus-visible:ring-accent/60 data-focus-visible:ring-offset-2",
      isSelected
        ? "bg-accent text-white hover:bg-accent-hover"
        : "border border-overlay/10 bg-transparent text-primary hover:bg-overlay/5",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
  >
    {children}
  </AriaToggleButton>
);
