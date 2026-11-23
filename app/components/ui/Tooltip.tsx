import type { ReactNode } from "react";

type TooltipProps = {
  children: ReactNode;
  content: string;
  delay?: number;
  className?: string;
};

export const Tooltip = ({ children, content, delay = 500, className }: TooltipProps) => (
  <span className="group relative inline-flex">
    {children}
    <span
      role="tooltip"
      className={[
        "pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
        "rounded-lg border border-overlay/10 bg-card px-3 py-1.5 text-sm text-primary shadow-xl",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {content}
    </span>
  </span>
);
