import { ModalOverlay, Modal, Dialog, Heading } from "react-aria-components";
import { Button } from "./Button.js";

type ConfirmDialogProps = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: "danger" | "default";
};

export const ConfirmDialog = ({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = "Confirm",
  variant = "default",
}: ConfirmDialogProps) => (
  <ModalOverlay
    isOpen={open}
    onOpenChange={(isOpen) => {
      if (!isOpen) onCancel();
    }}
    isDismissable={false}
    className="data-[entering]:animate-in data-[entering]:fade-in data-[exiting]:animate-out data-[exiting]:fade-out fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
  >
    <Modal className="w-full max-w-lg outline-hidden">
      <Dialog
        role="alertdialog"
        className="relative rounded-xl border border-overlay/6 bg-card p-6 shadow-2xl outline-hidden"
      >
        <Heading slot="title" className="mb-4 text-lg font-semibold text-primary">
          {title}
        </Heading>
        <p className="mb-6 text-muted">{message}</p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={variant === "danger" ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </Dialog>
    </Modal>
  </ModalOverlay>
);
