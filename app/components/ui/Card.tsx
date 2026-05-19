import type { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  href?: string;
  className?: string;
  [key: string]: unknown;
};

export const Card = ({ children, href, className, ...rest }: CardProps) => {
  const classes = [
    "block rounded-xl border border-overlay/6 dark:border-overlay-dark/6 bg-card dark:bg-card-dark p-6 transition-all duration-200",
    href ? "hover:-translate-y-0.5 hover:border-accent/30 no-underline" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return href ? (
    <a href={href} className={classes} {...rest}>
      {children}
    </a>
  ) : (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
};
