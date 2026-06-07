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
    className="inset-0 bg-black/60 backdrop-blur-xs data-[entering]:animate-in data-[entering]:fade-in data-[exiting]:animate-out data-[exiting]:fade-out fixed z-50 flex items-center justify-center"
  >
    <Modal className="max-w-lg w-full outline-hidden">
      <Dialog
        role="alertdialog"
        className="rounded-xl border-overlay/6 dark:border-overlay-dark/6 bg-card dark:bg-card-dark p-6 shadow-2xl relative border outline-hidden"
      >
        <Heading
          slot="title"
          className="text-lg font-semibold text-primary dark:text-primary-dark mb-4"
        >
          {title}
        </Heading>
        <p className="mb-6 text-muted dark:text-muted-dark">{message}</p>
        <div className="gap-3 flex justify-end">
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
