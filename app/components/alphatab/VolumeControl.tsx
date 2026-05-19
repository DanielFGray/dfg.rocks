import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface VolumeControlProps {
  volume: number;
  disabled: boolean;
  onVolumeChange: (volume: number) => void;
}

export function VolumeControl({ volume, disabled, onVolumeChange }: VolumeControlProps) {
  const [open, setOpen] = useState(false);
  const [popupStyle, setPopupStyle] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const popupId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const percentage = Math.round(volume * 100);

  const updatePopupPosition = useCallback(() => {
    if (typeof window === "undefined" || !buttonRef.current || !popupRef.current) {
      return;
    }

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const popupRect = popupRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    const left = Math.min(
      Math.max(viewportPadding, buttonRect.right - popupRect.width),
      window.innerWidth - popupRect.width - viewportPadding,
    );
    const top = Math.min(
      buttonRect.bottom + viewportPadding,
      window.innerHeight - popupRect.height - viewportPadding,
    );

    setPopupStyle({ top, left });
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target) &&
        !popupRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePopupPosition);
    window.addEventListener("scroll", updatePopupPosition, true);
    updatePopupPosition();

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePopupPosition);
      window.removeEventListener("scroll", updatePopupPosition, true);
    };
  }, [open, updatePopupPosition]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) {
      setPopupStyle(null);
    }
  }, [open]);

  const popup =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            id={popupId}
            ref={popupRef}
            role="dialog"
            aria-label="Track volume"
            className="gap-2 rounded-xl border-overlay/10 bg-card/95 px-3 py-3 shadow-2xl backdrop-blur-md dark:border-overlay-dark/10 dark:bg-card-dark/95 fixed z-60 flex min-w-18 flex-col items-center border"
            style={
              popupStyle
                ? { top: `${popupStyle.top}px`, left: `${popupStyle.left}px` }
                : { top: "-9999px", left: "-9999px" }
            }
          >
            <span className="font-medium text-muted dark:text-muted-dark text-[11px]">Track</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              data-testid="alphatab-track-volume-slider"
              className="m-0 h-28 w-5 cursor-pointer accent-[rgb(190,117,48)] [direction:rtl] [writing-mode:vertical-lr]"
            />
            <span className="text-muted dark:text-muted-dark text-[11px]">{percentage}%</span>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-label={`Track volume ${percentage}%`}
        aria-controls={popupId}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="alphatab-track-volume-button"
        className="bg-overlay/10 p-1.5 text-primary hover:bg-overlay/20 dark:bg-overlay-dark/10 dark:text-primary-dark dark:hover:bg-overlay-dark/20 flex items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 3.75a.75.75 0 00-1.264-.546L5.203 6H2.667a.75.75 0 00-.7.48A6.985 6.985 0 001.5 10c0 1.252.328 2.429.906 3.45a.75.75 0 00.761.55h2.036l3.533 2.796A.75.75 0 0010 16.25V3.75zM15.95 5.05a.75.75 0 00-1.06 1.061 5.5 5.5 0 010 7.778.75.75 0 001.06 1.06 7 7 0 000-9.899z" />
          <path d="M13.829 7.172a.75.75 0 00-1.061 1.06 2.5 2.5 0 010 3.536.75.75 0 001.06 1.06 4 4 0 000-5.656z" />
        </svg>
      </button>
      {popup}
    </div>
  );
}
