import {
  HourglassIcon,
  LoadingSpinner,
  MetronomeIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from "./icons.js";
import { ToggleButton } from "../ui/ToggleButton.js";
import { Tooltip } from "../ui/Tooltip.js";

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
      <Tooltip content={isPlaying ? "Pause" : "Play"}>
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={onPlayPause}
          disabled={isLoading}
          className="rounded-full bg-accent p-1.5 text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-muted dark:disabled:bg-muted-dark"
        >
          {isLoading ? <LoadingSpinner /> : isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
      </Tooltip>

      <Tooltip content="Stop">
        <button
          type="button"
          aria-label="Stop"
          onClick={onStop}
          disabled={isLoading}
          className="rounded-full bg-overlay/10 p-1.5 text-primary transition-colors hover:bg-overlay/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-overlay-dark/10 dark:text-primary-dark dark:hover:bg-overlay-dark/20"
        >
          <StopIcon />
        </button>
      </Tooltip>

      <Tooltip content={metronomeVolume > 0 ? "Metronome On" : "Metronome Off"}>
        <ToggleButton
          aria-label={metronomeVolume > 0 ? "Disable metronome" : "Enable metronome"}
          isSelected={metronomeVolume > 0}
          onChange={onMetronomeToggle}
          isDisabled={isLoading}
          className="rounded-full bg-overlay/10 p-1.5 hover:bg-accent/80 data-selected:bg-accent data-selected:text-white dark:bg-overlay-dark/10"
        >
          <MetronomeIcon active={metronomeVolume > 0} />
        </ToggleButton>
      </Tooltip>

      <Tooltip content={countInEnabled ? "Count In On" : "Count In Off"}>
        <ToggleButton
          aria-label={countInEnabled ? "Disable count in" : "Enable count in"}
          isSelected={countInEnabled}
          onChange={onCountInToggle}
          isDisabled={isLoading}
          className="rounded-full bg-overlay/10 p-1.5 hover:bg-accent/80 data-selected:bg-accent data-selected:text-white dark:bg-overlay-dark/10"
        >
          <HourglassIcon active={countInEnabled} />
        </ToggleButton>
      </Tooltip>
    </div>
  );
}
