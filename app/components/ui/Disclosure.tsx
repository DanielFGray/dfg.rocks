import { cn } from "tailwind-variants";
import type { ReactNode } from "react";
import {
  Disclosure as AriaDisclosure,
  DisclosurePanel as AriaDisclosurePanel,
  Button,
  Heading,
} from "react-aria-components";

type DisclosureChildren =
  | ReactNode
  | ((values: { isExpanded: boolean }) => ReactNode);

type DisclosureProps = {
  /** Identifies the disclosure inside a DisclosureGroup, which owns expansion. */
  id?: string;
  isExpanded?: boolean;
  onExpandedChange?: (isExpanded: boolean) => void;
  isDisabled?: boolean;
  children?: DisclosureChildren;
};

type DisclosureTriggerProps = {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
};

type DisclosurePanelProps = {
  children: ReactNode;
  className?: string;
};

export function Disclosure({ id, isExpanded, onExpandedChange, isDisabled, children }: DisclosureProps) {
  return (
    <AriaDisclosure
      id={id}
      isExpanded={isExpanded}
      onExpandedChange={onExpandedChange}
      isDisabled={isDisabled}
      className="flex flex-col"
    >
      {children}
    </AriaDisclosure>
  );
}

export function DisclosureTrigger({
  children,
  className,
  "data-testid": pwid,
}: DisclosureTriggerProps) {
  return (
    <Heading>
      <Button
        slot="trigger"
        data-testid={pwid}
        className={cn(
          "inline-flex items-center gap-2 text-sm font-semibold cursor-pointer transition-colors",
          "data-focus-visible:outline-hidden data-focus-visible:ring-2 data-focus-visible:ring-accent/60 data-focus-visible:ring-offset-2 rounded-sm",
          className,
        )}
      >
        {children}
      </Button>
    </Heading>
  );
}

export function DisclosurePanel({ children, className }: DisclosurePanelProps) {
  return (
    <AriaDisclosurePanel
      className={cn(
        "data-[entering]:animate-in data-[entering]:fade-in data-[entering]:slide-in-from-top-1",
        "data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:slide-out-to-top-1",
        className,
      )}
    >
      {children}
    </AriaDisclosurePanel>
  );
}
