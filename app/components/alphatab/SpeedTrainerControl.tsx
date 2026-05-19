import { useState } from "react";
import { Modal } from "../ui/Modal.js";

export type SpeedTrainerStepMode = "percent" | "bpm";

interface SpeedTrainerControlProps {
  isLooping: boolean;
  isLoading: boolean;
  hasSelection: boolean;
  loopLabel: string;
  loopCount: number;
  stepMode: SpeedTrainerStepMode;
  stepValue: number;
  currentSpeed: number;
  currentTempoBpm: number | null;
  onLoopToggle: () => void;
  onLoopCountChange: (value: number) => void;
  onStepModeChange: (mode: SpeedTrainerStepMode) => void;
  onStepValueChange: (value: number) => void;
  onClearSelection: () => void;
}

function formatSpeedLabel(speed: number): string {
  return `${Number.parseFloat(speed.toFixed(2))}x`;
}

export function SpeedTrainerControl({
  isLooping,
  isLoading,
  hasSelection,
  loopLabel,
  loopCount,
  stepMode,
  stepValue,
  currentSpeed,
  currentTempoBpm,
  onLoopToggle,
  onLoopCountChange,
  onStepModeChange,
  onStepValueChange,
  onClearSelection,
}: SpeedTrainerControlProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={isLoading}
          data-testid="alphatab-trainer-open"
          className="rounded-sm border border-overlay/10 bg-card px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-overlay/4 disabled:cursor-not-allowed disabled:opacity-50 dark:border-overlay-dark/10 dark:bg-card-dark dark:text-primary-dark dark:hover:bg-overlay-dark/4"
        >
          Trainer
        </button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Speed Trainer">
        <div data-testid="alphatab-trainer-modal" className="space-y-4">
          <p className="text-sm text-muted dark:text-muted-dark">
            Drag directly across the score to loop any passage, including partial measures, or leave
            the selection empty to train the full piece.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-overlay/8 bg-overlay/4 p-3 dark:border-overlay-dark/8 dark:bg-overlay-dark/4">
              <div className="text-[11px] tracking-wide text-muted uppercase dark:text-muted-dark">
                Loop range
              </div>
              <div className="mt-1 text-sm font-medium text-primary dark:text-primary-dark">
                {loopLabel}
              </div>
              {hasSelection && (
                <button
                  type="button"
                  onClick={onClearSelection}
                  disabled={isLoading}
                  data-testid="alphatab-loop-reset"
                  className="mt-2 text-xs text-accent underline underline-offset-2 transition-colors hover:text-accent-hover disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
                >
                  Reset to whole piece
                </button>
              )}
            </div>

            <div className="rounded-lg border border-overlay/8 bg-overlay/4 p-3 dark:border-overlay-dark/8 dark:bg-overlay-dark/4">
              <div className="text-[11px] tracking-wide text-muted uppercase dark:text-muted-dark">
                Current tempo
              </div>
              <div className="mt-1 text-sm font-medium text-primary dark:text-primary-dark">
                {currentTempoBpm === null
                  ? formatSpeedLabel(currentSpeed)
                  : `${Number.parseFloat(currentTempoBpm.toFixed(1))} BPM`}
              </div>
              <div className="mt-1 text-xs text-muted dark:text-muted-dark">
                Playback speed: {formatSpeedLabel(currentSpeed)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-primary dark:text-primary-dark">Loop playback</span>
            <button
              type="button"
              onClick={onLoopToggle}
              disabled={isLoading}
              data-testid="alphatab-loop-toggle"
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isLooping
                  ? "bg-accent text-white hover:bg-accent-hover"
                  : "border border-overlay/10 bg-card text-primary hover:bg-overlay/4 dark:border-overlay-dark/10 dark:bg-card-dark dark:text-primary-dark dark:hover:bg-overlay-dark/4"
              }`}
            >
              {isLooping ? "On" : "Off"}
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-primary dark:text-primary-dark">
              Tempo progression
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-primary dark:text-primary-dark">
              <span>After looping</span>
              <input
                type="number"
                min={1}
                step={1}
                value={loopCount}
                onChange={(e) => onLoopCountChange(Number.parseFloat(e.target.value))}
                disabled={isLoading}
                data-testid="alphatab-trainer-loop-count"
                className="w-16 rounded-md border border-overlay/10 bg-card px-2 py-1.5 text-sm text-primary disabled:opacity-50 dark:border-overlay-dark/10 dark:bg-card-dark dark:text-primary-dark"
              />
              <span>{loopCount === 1 ? "time," : "times,"} increase tempo by</span>
              <input
                type="number"
                min={0}
                step={stepMode === "bpm" ? 1 : 0.5}
                value={stepValue}
                onChange={(e) => onStepValueChange(Number.parseFloat(e.target.value))}
                disabled={isLoading}
                data-testid="alphatab-trainer-step-input"
                className="w-20 rounded-md border border-overlay/10 bg-card px-2 py-1.5 text-sm text-primary disabled:opacity-50 dark:border-overlay-dark/10 dark:bg-card-dark dark:text-primary-dark"
              />
              <select
                value={stepMode}
                onChange={(e) => onStepModeChange(e.target.value === "bpm" ? "bpm" : "percent")}
                disabled={isLoading}
                data-testid="alphatab-trainer-step-mode"
                className="rounded-md border border-overlay/10 bg-card px-2 py-1.5 text-sm text-primary disabled:opacity-50 dark:border-overlay-dark/10 dark:bg-card-dark dark:text-primary-dark"
              >
                <option value="percent">%</option>
                <option value="bpm">BPM</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
