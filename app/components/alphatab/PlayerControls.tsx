import {
  HourglassIcon,
  LoadingSpinner,
  MetronomeIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from "./icons.js";

export function PlayerControls({
  metronomeVolume,
  countInEnabled,
  isLoading,
  isPlaying,
  onPlayPause,
  onStop,
  onMetronomeToggle,
  onCountInToggle,
}: {
  metronomeVolume: number;
  countInEnabled: boolean;
  isLoading: boolean;
  isPlaying: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onMetronomeToggle: () => void;
  onCountInToggle: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        onClick={onPlayPause}
        disabled={isLoading}
        className="rounded-full bg-accent p-1.5 text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-muted dark:disabled:bg-muted-dark"
        title={isPlaying ? "Pause" : "Play"}
      >
        {isLoading ? <LoadingSpinner /> : isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <button
        onClick={onStop}
        disabled={isLoading}
        className="rounded-full bg-overlay/10 p-1.5 text-primary transition-colors hover:bg-overlay/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-overlay-dark/10 dark:text-primary-dark dark:hover:bg-overlay-dark/20"
        title="Stop"
      >
        <StopIcon />
      </button>

      <button
        onClick={onMetronomeToggle}
        disabled={isLoading}
        className={`rounded-full p-1.5 transition-colors ${
          metronomeVolume > 0
            ? "bg-accent text-white"
            : "bg-overlay/10 text-primary dark:bg-overlay-dark/10 dark:text-primary-dark"
        } hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-50`}
        title={metronomeVolume > 0 ? "Metronome On" : "Metronome Off"}
      >
        <MetronomeIcon active={metronomeVolume > 0} />
      </button>

      <button
        onClick={onCountInToggle}
        disabled={isLoading}
        className={`rounded-full p-1.5 transition-colors ${
          countInEnabled
            ? "bg-accent text-white"
            : "bg-overlay/10 text-primary dark:bg-overlay-dark/10 dark:text-primary-dark"
        } hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-50`}
        title={countInEnabled ? "Count In On" : "Count In Off"}
      >
        <HourglassIcon active={countInEnabled} />
      </button>
    </div>
  );
}
