import { formatTime } from "./helpers.js";

interface ProgressBarProps {
  currentTimeMs: number;
  endTimeMs: number;
  isLoading: boolean;
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function ProgressBar({ currentTimeMs, endTimeMs, isLoading, onSeek }: ProgressBarProps) {
  const progressPercent = endTimeMs > 0 ? (currentTimeMs / endTimeMs) * 100 : 0;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div
        data-testid="alphatab-time"
        className="min-w-[72px] shrink-0 font-mono text-[11px] text-muted md:min-w-[86px] md:text-xs dark:text-muted-dark">
        {formatTime(currentTimeMs / 1000)} / {formatTime(endTimeMs / 1000)}
      </div>

      <div className="relative min-w-0 flex-1">
        <div className="h-1.5 overflow-hidden rounded-full bg-overlay/15 md:h-2 dark:bg-overlay-dark/15">
          <div className="h-full bg-accent" style={{ width: `${progressPercent}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={endTimeMs || 100}
          value={currentTimeMs}
          onChange={onSeek}
          disabled={isLoading}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}
