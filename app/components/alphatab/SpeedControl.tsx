import { useEffect, useRef } from "react";

interface SpeedControlProps {
  playbackSpeed: number;
  isLoading: boolean;
  onSpeedChange: (speed: number) => void;
}

function formatSpeedValue(speed: number): string {
  return Number.parseFloat(speed.toFixed(3)).toString();
}

export function SpeedControl({ playbackSpeed, isLoading, onSpeedChange }: SpeedControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.value = formatSpeedValue(playbackSpeed);
    }
  }, [playbackSpeed]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const onNativeInput = () => {
      const nextSpeed = Number.parseFloat(el.value);
      if (Number.isFinite(nextSpeed)) {
        onSpeedChange(nextSpeed);
      }
    };

    el.addEventListener("input", onNativeInput);
    return () => el.removeEventListener("input", onNativeInput);
  }, [onSpeedChange]);

  return (
    <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <span className="text-[11px] text-muted dark:text-muted-dark">Speed</span>
      <div className="flex items-center gap-1 rounded-sm border border-overlay/10 bg-card px-1.5 py-0.5 dark:border-overlay-dark/10 dark:bg-card-dark">
        <input
          ref={inputRef}
          type="number"
          min={0.25}
          max={3}
          step={0.05}
          inputMode="decimal"
          defaultValue={formatSpeedValue(playbackSpeed)}
          disabled={isLoading}
          data-testid="alphatab-speed-input"
          className="w-14 border-0 bg-transparent p-0 text-right text-xs text-primary outline-hidden disabled:opacity-50 dark:text-primary-dark"
          onBlur={(e) => {
            const nextSpeed = Number.parseFloat(e.currentTarget.value);
            if (Number.isFinite(nextSpeed)) {
              onSpeedChange(nextSpeed);
              return;
            }
            e.currentTarget.value = formatSpeedValue(playbackSpeed);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }

            if (e.key === "Escape") {
              e.currentTarget.value = formatSpeedValue(playbackSpeed);
            }
          }}
        />
        <span className="text-xs text-muted dark:text-muted-dark">x</span>
      </div>
    </label>
  );
}
