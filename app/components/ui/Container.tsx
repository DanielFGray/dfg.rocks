import type { ComponentProps, ReactNode } from "react";
import { cn } from "tailwind-variants";

/** The page's main column. */
export const Main = ({ className, ...props }: ComponentProps<"main">) => (
  <main className={cn("mx-auto max-w-275 px-5 pt-20 pb-16 md:px-8", className)} {...props} />
);

/** A band of the page, padded from the column's edges. */
export const Section = ({
  children,
  className,
  ...props
}: ComponentProps<"section"> & { children?: ReactNode }) => (
  <section className={cn("mx-auto max-w-275 px-5 py-16 md:px-8 md:py-24", className)} {...props}>
    {children}
  </section>
);
