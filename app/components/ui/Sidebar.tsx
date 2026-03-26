import type { ReactNode } from "react";
import {
  ModalOverlay,
  Modal,
  Dialog,
  Heading,
} from "react-aria-components";
import { Button } from "./Button.js";

type SidebarProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

export const Sidebar = ({ open, onClose, title, children, footer }: SidebarProps) => (
  <ModalOverlay
    isOpen={open}
    onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}
    isDismissable
    className="fixed inset-0 z-[200] md:hidden data-[entering]:animate-in data-[entering]:fade-in data-[exiting]:animate-out data-[exiting]:fade-out"
  >
    <Modal className="absolute top-0 right-0 h-full w-72 outline-none">
      <Dialog className="h-full bg-card border-l border-white/[0.06] shadow-2xl flex flex-col outline-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <Heading slot="title" className="text-lg font-semibold text-primary">
            {title}
          </Heading>
          <Button
            variant="ghost"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 px-1.5 py-1.5 text-muted transition-colors hover:bg-white/5 hover:text-primary"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </Button>
        </div>
        <div className="flex flex-col flex-1 overflow-y-auto">
          {children}
        </div>
        {footer ? (
          <div className="border-t border-white/[0.06]">
            {footer}
          </div>
        ) : null}
      </Dialog>
    </Modal>
  </ModalOverlay>
);
