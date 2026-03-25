import type { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  href?: string;
  className?: string;
};

export const Card = ({ children, href, className }: CardProps) => {
  const classes = [
    "block rounded-xl border border-white/[0.06] bg-card p-6 transition-all duration-200",
    href ? "hover:-translate-y-0.5 hover:border-accent/30 no-underline" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return href ? (
    <a href={href} className={classes}>
      {children}
    </a>
  ) : (
    <div className={classes}>{children}</div>
  );
};
