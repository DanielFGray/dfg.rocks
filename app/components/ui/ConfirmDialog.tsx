import {
  ModalOverlay,
  Modal,
  Dialog,
  Heading,
} from "react-aria-components";
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
    onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}
    isDismissable={false}
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm data-[entering]:animate-in data-[entering]:fade-in data-[exiting]:animate-out data-[exiting]:fade-out"
  >
    <Modal className="w-full max-w-lg outline-none">
      <Dialog role="alertdialog" className="relative rounded-xl border border-white/[0.06] bg-card p-6 shadow-2xl outline-none">
        <Heading slot="title" className="text-lg font-semibold text-primary mb-4">
          {title}
        </Heading>
        <p className="mb-6 text-muted">{message}</p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </Dialog>
    </Modal>
  </ModalOverlay>
);
