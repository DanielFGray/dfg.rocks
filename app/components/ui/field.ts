import { tv } from "tailwind-variants";

/**
 * The parts that the labelled form controls in ui/ share. `invalid` turns the control's border
 * red; each control sets it from its error prop, the same value it gives react-aria's isInvalid.
 */
export const field = tv({
  slots: {
    root: "flex flex-col gap-1.5",
    label: "text-sm font-medium text-muted",
    control:
      "rounded-lg border border-overlay/10 bg-card px-4 py-3 text-primary outline-hidden transition-colors placeholder:text-muted/50 data-focused:border-accent data-focused:ring-1 data-focused:ring-accent/50",
    error: "mt-0.5 text-sm text-red-600 dark:text-red-400",
    popover:
      "max-h-60 w-(--trigger-width) overflow-auto rounded-lg border border-overlay/10 bg-card shadow-2xl",
    listBox: "p-1 outline-hidden",
    option:
      "cursor-pointer rounded-md px-3 py-2 text-sm text-primary outline-hidden transition-colors data-focused:bg-overlay/8 data-selected:text-accent",
  },
  variants: {
    invalid: { true: { control: "border-red-500/50" } },
  },
});
