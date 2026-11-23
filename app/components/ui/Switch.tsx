import { Switch as AriaSwitch } from "react-aria-components";

type SwitchProps = {
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  isDisabled?: boolean;
  children?: string;
  className?: string;
  "data-testid"?: string;
};

export const Switch = ({
  isSelected,
  onChange,
  isDisabled,
  children,
  className,
  "data-testid": pwid,
}: SwitchProps) => (
  <AriaSwitch
    isSelected={isSelected}
    onChange={onChange}
    isDisabled={isDisabled}
    data-testid={pwid}
    className={[
      "group inline-flex items-center gap-3 cursor-pointer",
      "data-disabled:cursor-not-allowed data-disabled:opacity-50",
      "data-focus-visible:outline-hidden data-focus-visible:ring-2 data-focus-visible:ring-accent/60 data-focus-visible:ring-offset-2 data-focus-visible:ring-offset-bg rounded-sm",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
  >
    <div className="h-5 w-9 rounded-full border-2 border-transparent bg-overlay/20 transition-colors group-data-focus-visible:ring-2 group-data-focus-visible:ring-accent/60 group-data-selected:bg-accent">
      <div className="h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform group-data-selected:translate-x-4" />
    </div>
    {children ? (
      <span className="text-sm text-primary">{children}</span>
    ) : null}
  </AriaSwitch>
);
