import type { ReactNode } from "react";

type SidebarProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

export const Sidebar = ({ open, onClose, title, children, footer }: SidebarProps) => {
  if (!open) return <div className="hidden" />;

  return (
    <div
      className="fixed inset-0 z-[200] md:hidden"
      onClick={(e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="absolute top-0 right-0 h-full w-72 bg-card border-l border-white/[0.06] shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <h2 className="text-lg font-semibold text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/5 hover:text-primary cursor-pointer"
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
          </button>
        </div>
        <div className="flex flex-col flex-1 overflow-y-auto">
          {children}
        </div>
        {footer ? (
          <div className="border-t border-white/[0.06]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
};
