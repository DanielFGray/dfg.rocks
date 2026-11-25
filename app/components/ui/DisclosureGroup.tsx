import { cn } from "tailwind-variants";
import type { ReactNode } from "react";
import { DisclosureGroup as AriaDisclosureGroup } from "react-aria-components";

type DisclosureGroupProps = {
  children: ReactNode;
  className?: string;
};

export function DisclosureGroup({ children, className }: DisclosureGroupProps) {
  return (
    <AriaDisclosureGroup allowsMultipleExpanded={false} className={cn(className)}>
      {children}
    </AriaDisclosureGroup>
  );
}
