import type { VChild } from "fibrae/shared";

type CardProps = {
  children: VChild;
  href?: string;
  class?: string;
};

export const Card = ({ children, href, class: className }: CardProps) => {
  const classes = [
    "block rounded-xl border border-white/[0.06] bg-card p-6 transition-all duration-200",
    href ? "hover:-translate-y-0.5 hover:border-accent/30 no-underline" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return href ? (
    <a href={href} class={classes}>
      {children}
    </a>
  ) : (
    <div class={classes}>{children}</div>
  );
};
