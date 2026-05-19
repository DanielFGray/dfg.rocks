import { useEffect, useRef, useState } from "react";

interface SpeedControlProps {
  playbackSpeed: number;
  isLoading: boolean;
  onSpeedChange: (speed: number) => void;
}

function formatSpeedValue(speed: number): string {
  return Number.parseFloat(speed.toFixed(3)).toString();
}

export function SpeedControl({ playbackSpeed, isLoading, onSpeedChange }: SpeedControlProps) {
  const [inputValue, setInputValue] = useState(() => formatSpeedValue(playbackSpeed));
  const isEditingRef = useRef(false);

  useEffect(() => {
    if (!isEditingRef.current) {
      setInputValue(formatSpeedValue(playbackSpeed));
    }
  }, [playbackSpeed]);

  const commitValue = () => {
    const nextSpeed = Number.parseFloat(inputValue);

    isEditingRef.current = false;

    if (Number.isFinite(nextSpeed)) {
      onSpeedChange(nextSpeed);
      return;
    }

    setInputValue(formatSpeedValue(playbackSpeed));
  };

  return (
    <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <span className="text-[11px] text-muted dark:text-muted-dark">Speed</span>
      <div className="flex items-center gap-1 rounded-sm border border-overlay/10 bg-card px-1.5 py-0.5 dark:border-overlay-dark/10 dark:bg-card-dark">
        <input
          type="number"
          min={0.25}
          max={3}
          step={0.05}
          inputMode="decimal"
          value={inputValue}
          disabled={isLoading}
          data-testid="alphatab-speed-input"
          className="w-14 border-0 bg-transparent p-0 text-right text-xs text-primary outline-hidden disabled:opacity-50 dark:text-primary-dark"
          onFocus={() => {
            isEditingRef.current = true;
          }}
          onChange={(e) => {
            isEditingRef.current = true;
            setInputValue(e.target.value);
          }}
          onBlur={commitValue}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitValue();
            }

            if (e.key === "Escape") {
              isEditingRef.current = false;
              setInputValue(formatSpeedValue(playbackSpeed));
            }
          }}
        />
        <span className="text-xs text-muted dark:text-muted-dark">x</span>
      </div>
    </label>
  );
}
