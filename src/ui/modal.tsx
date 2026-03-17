import type { VChild } from "fibrae/shared";

type ModalProps = {
  open: boolean;
  onclose: () => void;
  title: string;
  children: VChild;
};

export const Modal = ({ open, onclose, title, children }: ModalProps) => {
  if (!open) return <div class="hidden" />;

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onclick={(e: Event) => {
        if (e.target === e.currentTarget) onclose();
      }}
    >
      <div class="relative w-full max-w-lg rounded-xl border border-white/[0.06] bg-card p-6 shadow-2xl">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-primary">{title}</h2>
          <button
            type="button"
            onclick={onclose}
            class="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/5 hover:text-primary cursor-pointer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
