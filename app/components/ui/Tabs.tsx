import { cn } from "tailwind-variants";
import type { ReactNode } from "react";
import type { Key } from "@react-types/shared";
import {
  Tabs as AriaTabs,
  TabList as AriaTabList,
  Tab as AriaTab,
  TabPanel as AriaTabPanel,
} from "react-aria-components";

type TabsProps = {
  selectedKey?: Key;
  defaultSelectedKey?: Key;
  onSelectionChange?: (key: Key) => void;
  children: ReactNode;
  className?: string;
};

type TabListProps = {
  children: ReactNode;
  className?: string;
};

type TabProps = {
  id: Key;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
};

type TabPanelProps = {
  id: Key;
  children: ReactNode;
  className?: string;
};

export function Tabs({
  selectedKey,
  defaultSelectedKey,
  onSelectionChange,
  children,
  className,
}: TabsProps) {
  return (
    <AriaTabs
      selectedKey={selectedKey}
      defaultSelectedKey={defaultSelectedKey}
      onSelectionChange={onSelectionChange}
      className={className}
    >
      {children}
    </AriaTabs>
  );
}

export function TabList({ children, className }: TabListProps) {
  return (
    <AriaTabList className={cn("flex gap-1 rounded-xl bg-overlay/4 p-1", className)}>
      {children}
    </AriaTabList>
  );
}

export function Tab({ id, children, className, "data-testid": pwid }: TabProps) {
  return (
    <AriaTab
      id={id}
      data-testid={pwid}
      className={cn(
        "flex-1 cursor-pointer rounded-lg py-2.5 text-sm font-medium transition-colors text-center",
        "data-selected:bg-overlay/8 data-selected:text-primary",
        "text-muted hover:text-primary",
        "data-focus-visible:outline-hidden data-focus-visible:ring-2 data-focus-visible:ring-accent/60 data-focus-visible:ring-offset-2",
        className,
      )}
    >
      {children}
    </AriaTab>
  );
}

export function TabPanel({ id, children, className }: TabPanelProps) {
  return (
    <AriaTabPanel id={id} className={className}>
      {children}
    </AriaTabPanel>
  );
}
