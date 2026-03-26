import type { ReactNode } from "react";
import {
  ModalOverlay,
  Modal as AriaModal,
  Dialog,
  Heading,
} from "react-aria-components";
import { Button } from "./Button.js";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

export const Modal = ({ open, onClose, title, children }: ModalProps) => (
  <ModalOverlay
    isOpen={open}
    onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}
    isDismissable
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm data-[entering]:animate-in data-[entering]:fade-in data-[exiting]:animate-out data-[exiting]:fade-out"
  >
    <AriaModal className="w-full max-w-lg outline-none">
      <Dialog className="relative rounded-xl border border-white/[0.06] bg-card p-6 shadow-2xl outline-none">
        <div className="mb-4 flex items-center justify-between">
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
        {children}
      </Dialog>
    </AriaModal>
  </ModalOverlay>
);
