import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const card = tv({
  base: "block rounded-xl border border-overlay/6 bg-card p-6 transition-all duration-200",
  variants: {
    link: { true: "no-underline hover:-translate-y-0.5 hover:border-accent/30" },
  },
});

type CardProps = {
  children: ReactNode;
  href?: string;
  className?: string;
  [key: string]: unknown;
};

/** A panel; with href it renders a link that lifts on hover. */
export const Card = ({ children, href, className, ...rest }: CardProps) => {
  const classes = card({ link: href !== undefined, className });
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
