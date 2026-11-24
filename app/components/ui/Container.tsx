import type { ComponentProps } from "react";
import { cn } from "tailwind-variants";

/** The page's main column. */
export const Main = ({ className, ...props }: ComponentProps<"main">) => (
  <main className={cn("mx-auto max-w-275 px-5 pt-20 pb-16 md:px-8", className)} {...props} />
);
