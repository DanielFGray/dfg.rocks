import { Modal } from "./Modal";
import { Button } from "./Button";

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
  <Modal open={open} onClose={onCancel} title={title}>
    <p className="mb-6 text-muted">{message}</p>
    <div className="flex justify-end gap-3">
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <button
        type="button"
        onClick={onConfirm}
        className={[
          "inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-all cursor-pointer",
          variant === "danger"
            ? "bg-red-600 text-white hover:bg-red-500 hover:-translate-y-px"
            : "bg-accent text-white hover:bg-accent-hover hover:-translate-y-px",
        ].join(" ")}
      >
        {confirmLabel}
      </button>
    </div>
  </Modal>
);
