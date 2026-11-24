import type { ComponentProps, ReactNode } from "react";
import { tv } from "tailwind-variants";

const table = tv({
  slots: {
    wrapper: "overflow-x-auto rounded-lg border border-overlay/10",
    table: "w-full text-left text-sm",
    head: "bg-overlay/4 text-xs text-muted",
    foot: "bg-overlay/4 text-xs",
    row: "border-t border-overlay/8",
    headerCell: "px-4 py-3 font-medium",
    cell: "px-4 py-3",
  },
  variants: {
    hover: { true: { row: "hover:bg-overlay/4" } },
  },
});

const t = table();

/** A data table in a bordered box that scrolls sideways when it is wider than the page. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={t.wrapper({ className })}>
      <table className={t.table()}>{children}</table>
    </div>
  );
}

/** The header: one row of Th cells. */
export function TableHead({ children }: { children: ReactNode }) {
  return (
    <thead className={t.head()}>
      <tr>{children}</tr>
    </thead>
  );
}

export function TableFoot({ children }: { children: ReactNode }) {
  return <tfoot className={t.foot()}>{children}</tfoot>;
}

/** A body row with a top border; `hover` highlights it under the pointer. */
export function Tr({ hover, className, ...props }: ComponentProps<"tr"> & { hover?: boolean }) {
  return <tr className={table({ hover }).row({ className })} {...props} />;
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return <th className={t.headerCell({ className })} {...props} />;
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={t.cell({ className })} {...props} />;
}
