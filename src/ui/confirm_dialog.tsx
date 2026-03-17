import { Modal } from "./modal.js";
import { Button } from "./button.js";

type ConfirmDialogProps = {
  open: boolean;
  onconfirm: () => void;
  oncancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: "danger" | "default";
};

export const ConfirmDialog = ({
  open,
  onconfirm,
  oncancel,
  title,
  message,
  confirmLabel = "Confirm",
  variant = "default",
}: ConfirmDialogProps) => (
  <Modal open={open} onclose={oncancel} title={title}>
    <p class="mb-6 text-muted">{message}</p>
    <div class="flex justify-end gap-3">
      <Button variant="ghost" onclick={oncancel}>
        Cancel
      </Button>
      <button
        type="button"
        onclick={onconfirm}
        class={[
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
