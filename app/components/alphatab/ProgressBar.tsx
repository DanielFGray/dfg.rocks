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
    <div className="min-w-0 gap-2 flex flex-1 items-center">
      <div className="font-mono text-muted md:min-w-[86px] md:text-xs dark:text-muted-dark min-w-[72px] shrink-0 text-[11px]">
        {formatTime(currentTimeMs / 1000)} / {formatTime(endTimeMs / 1000)}
      </div>

      <div className="min-w-0 relative flex-1">
        <div className="h-1.5 bg-overlay/15 md:h-2 dark:bg-overlay-dark/15 overflow-hidden rounded-full">
          <div className="bg-accent h-full" style={{ width: `${progressPercent}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={endTimeMs || 100}
          value={currentTimeMs}
          onChange={onSeek}
          disabled={isLoading}
          className="inset-0 absolute h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}
