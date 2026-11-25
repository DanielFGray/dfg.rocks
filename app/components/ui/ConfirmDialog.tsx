import { useState } from "react";
import { ModalOverlay, Modal, Dialog, Heading } from "react-aria-components";
import { Button } from "./Button.js";
import { getErrorMessage } from "../../lib/errors.js";

type ConfirmDialogProps = {
  open: boolean;
  /**
   * Awaited contract: when onConfirm returns a promise, the dialog holds open
   * with its controls disabled until the promise settles. A rejection keeps the
   * dialog open and shows the server's message; a resolution leaves closing to
   * the caller (which should close only on success). A void return completes
   * immediately.
   */
  onConfirm: () => void | Promise<void>;
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
}: ConfirmDialogProps) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset a stale error when the dialog is opened again for a new target.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setError(null);
  }
  if (!open && wasOpen) {
    setWasOpen(false);
  }

  const handleConfirm = () => {
    setError(null);
    const result = onConfirm();
    if (!(result instanceof Promise)) return;
    setPending(true);
    void result.then(
      () => setPending(false),
      (cause: unknown) => {
        setPending(false);
        setError(getErrorMessage(cause));
      },
    );
  };

  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !pending) onCancel();
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
          {error ? (
            <p role="alert" className="mb-6 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={variant === "danger" ? "danger" : "primary"}
              onClick={handleConfirm}
              disabled={pending}
            >
              {pending ? "Working..." : confirmLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
};
