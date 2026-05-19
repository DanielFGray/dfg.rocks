import type { ReactNode } from "react";
import { ModalOverlay, Modal, Dialog, Heading } from "react-aria-components";
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
    onOpenChange={(isOpen) => {
      if (!isOpen) onClose();
    }}
    isDismissable
    className="inset-0 md:hidden data-[entering]:animate-in data-[entering]:fade-in data-[exiting]:animate-out data-[exiting]:fade-out fixed z-200"
  >
    <Modal className="top-0 right-0 w-72 absolute h-full outline-hidden">
      <Dialog className="bg-card dark:bg-card-dark border-overlay/6 dark:border-overlay-dark/6 shadow-2xl flex h-full flex-col border-l outline-hidden">
        <div className="px-6 py-4 border-overlay/6 dark:border-overlay-dark/6 flex items-center justify-between border-b">
          <Heading
            slot="title"
            className="text-lg font-semibold text-primary dark:text-primary-dark"
          >
            {title}
          </Heading>
          <Button
            variant="ghost"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 px-1.5 py-1.5 text-muted dark:text-muted-dark hover:bg-overlay/5 dark:hover:bg-overlay-dark/5 hover:text-primary dark:hover:text-primary-dark transition-colors"
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
        <div className="flex flex-1 flex-col overflow-y-auto">{children}</div>
        {footer ? (
          <div className="border-overlay/6 dark:border-overlay-dark/6 border-t">
            {footer}
          </div>
        ) : null}
      </Dialog>
    </Modal>
  </ModalOverlay>
);
