import { useEffect, useRef, useState } from "react";
import { useScorePlayer } from "gigbag.js/player/use-score-player";
import { IconButton } from "gigbag.js/player/icon-button";
import { SeekBar } from "gigbag.js/player/seek-bar";
import { TrackSelect } from "gigbag.js/player/track-select";
import { ZoomControl } from "gigbag.js/player/zoom-control";
import { SpeedInput } from "gigbag.js/player/speed-input";
import { TrainerFields } from "gigbag.js/player/trainer-fields";
import { VolumeSlider } from "gigbag.js/player/volume-slider";
import {
  CountInIcon,
  LoadingSpinner,
  MetronomeIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from "gigbag.js/player/icons";
import { barsLabel, barsOfBeatSpan } from "gigbag.js/charts/score-bars";
import {
  formatNotationTrackLabel,
  toMaterialNotationTrack,
} from "../../../shared/notationTracks.js";
import { Modal } from "../ui/Modal.js";

export interface AlphaTabPlayerProps {
  /** A score file by URL, or alphaTex source. */
  source: { url: string } | { tex: string };
  defaultTrackIndex?: number | null;
  /** Whole seconds of playing time not yet reported; the app adds them up. */
  onPlaybackSeconds?: (seconds: number) => void;
  onDurationSeconds?: (seconds: number) => void;
  /** Called when playback stops after it has run. */
  onSessionEnd?: () => void;
}

// On phones the controls and the score break out of the page padding to span the viewport.
const viewportClass =
  "box-border mx-[calc(50%-(var(--viewport-client-width)/2))] w-(--viewport-client-width) max-w-(--viewport-client-width) md:mx-0 md:w-auto md:max-w-none";

const controlClass =
  "rounded-full bg-overlay/10 p-1.5 text-primary transition-colors hover:bg-overlay/20 data-[pressed=true]:bg-accent data-[pressed=true]:text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-overlay-dark/10 dark:text-primary-dark dark:hover:bg-overlay-dark/20";

const selectClass =
  "rounded-sm border border-overlay/10 bg-card px-1.5 py-0.5 text-xs text-primary disabled:opacity-50 dark:border-overlay-dark/10 dark:bg-card-dark dark:text-primary-dark";

const partClass = {
  root: "flex min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-muted dark:text-muted-dark",
  input: `${selectClass} w-20`,
};

export function AlphaTabPlayer({
  source,
  defaultTrackIndex,
  onPlaybackSeconds,
  onDurationSeconds,
  onSessionEnd,
}: AlphaTabPlayerProps) {
  const [trainerOpen, setTrainerOpen] = useState(false);
  const { host, keyRoot, state, actions } = useScorePlayer({
    source,
    defaultTrack: defaultTrackIndex ?? undefined,
    onPracticeTime: onPlaybackSeconds,
    // The same label the upload form and the assignment page show for a track.
    trackLabel: (track) => formatNotationTrackLabel(toMaterialNotationTrack(track)),
  });

  const wasPlaying = useRef(false);
  useEffect(() => {
    if (wasPlaying.current && !state.playing) onSessionEnd?.();
    wasPlaying.current = state.playing;
  }, [state.playing, onSessionEnd]);

  useEffect(() => {
    if (state.endMs > 0) onDurationSeconds?.(state.endMs / 1000);
  }, [state.endMs, onDurationSeconds]);

  const loading = state.status === "loading" || state.sound === "loading";
  const selectionText = state.selection ? barsLabel(barsOfBeatSpan(state.selection)) : null;
  const trackVolume = state.track === null ? 1 : (state.mixer.tracks[state.track]?.volume ?? 1);

  return (
    <div ref={keyRoot} className="mb-8">
      <div
        className={`sticky top-[calc(env(safe-area-inset-top,0)+var(--portal-nav-visible-height))] z-30 bg-inherit backdrop-blur-md ${viewportClass}`}
      >
        <div className="flex min-w-0 flex-col gap-2 p-2 pb-1 md:flex-row md:items-center md:gap-3 md:pb-0">
          <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
            <div className="flex shrink-0 items-center gap-2">
              <IconButton
                label={state.playing ? "Pause" : "Play"}
                disabled={state.status !== "ready"}
                onClick={actions.playPause}
                parts={{
                  button: {
                    className: `${controlClass} bg-accent text-white hover:bg-accent-hover`,
                  },
                }}
              >
                {loading ? <LoadingSpinner /> : state.playing ? <PauseIcon /> : <PlayIcon />}
              </IconButton>
              <IconButton
                label="Stop"
                disabled={state.status !== "ready"}
                onClick={actions.stop}
                parts={{ button: { className: controlClass } }}
              >
                <StopIcon />
              </IconButton>
              <IconButton
                label={state.metronome ? "Disable metronome" : "Enable metronome"}
                pressed={state.metronome}
                disabled={state.status !== "ready"}
                onClick={() => actions.setMetronome(!state.metronome)}
                parts={{ button: { className: controlClass } }}
              >
                <MetronomeIcon />
              </IconButton>
              <IconButton
                label={state.countIn ? "Disable count in" : "Enable count in"}
                pressed={state.countIn}
                disabled={state.status !== "ready"}
                onClick={() => actions.setCountIn(!state.countIn)}
                parts={{ button: { className: controlClass } }}
              >
                <CountInIcon />
              </IconButton>
            </div>

            <SeekBar
              positionMs={state.positionMs}
              endMs={state.endMs}
              disabled={state.status !== "ready"}
              onSeek={actions.seek}
              parts={{
                root: { className: partClass.root },
                time: { "data-testid": "alphatab-time" },
                range: { className: "min-w-0 flex-1" },
              }}
            />
          </div>

          <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-0.5 md:flex-[0_1_auto] md:overflow-visible md:pb-0">
            {state.track !== null && state.tracks.length > 1 && (
              <TrackSelect
                tracks={state.tracks}
                track={state.track}
                disabled={state.status !== "ready"}
                onTrack={actions.setTrack}
                parts={{
                  root: { className: partClass.root },
                  select: { className: selectClass, "data-testid": "alphatab-track-select" },
                }}
              />
            )}

            <ZoomControl
              zoom={state.zoom}
              onZoom={actions.setZoom}
              parts={{
                root: { className: partClass.root },
                zoomOut: { "data-testid": "alphatab-zoom-out" },
                zoomIn: { "data-testid": "alphatab-zoom-in" },
                reset: { "data-testid": "alphatab-zoom-reset" },
              }}
            />

            <SpeedInput
              speed={state.speed}
              onSpeed={actions.setSpeed}
              parts={{
                root: { className: partClass.root },
                input: { className: partClass.input, "data-testid": "alphatab-speed-input" },
              }}
            />

            <button
              type="button"
              onClick={() => setTrainerOpen(true)}
              disabled={state.status !== "ready"}
              aria-pressed={state.trainer.loop}
              data-testid="alphatab-trainer-open"
              className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                state.trainer.loop
                  ? "border border-accent bg-accent text-white hover:bg-accent-hover"
                  : "border border-overlay/10 bg-card text-primary hover:bg-overlay/4 dark:border-overlay-dark/10 dark:bg-card-dark dark:text-primary-dark dark:hover:bg-overlay-dark/4"
              }`}
            >
              Speed Trainer
            </button>

            <VolumeSlider
              volume={trackVolume}
              disabled={state.status !== "ready" || state.track === null}
              onVolume={(volume) =>
                state.track !== null && actions.setTrackVolume(state.track, volume)
              }
              parts={{
                root: { className: partClass.root },
                input: {
                  className: partClass.input,
                  "data-testid": "alphatab-track-volume-slider",
                },
              }}
            />
          </div>
        </div>
        {state.error ? (
          <p className="px-2 text-sm text-red-600 dark:text-red-400">{state.error}</p>
        ) : null}
      </div>

      <Modal open={trainerOpen} onClose={() => setTrainerOpen(false)} title="Speed Trainer">
        <div data-testid="alphatab-trainer-modal" className="space-y-4">
          <TrainerFields
            speed={state.speed}
            tempo={state.tempo}
            loop={state.trainer.loop}
            onLoop={actions.setLoop}
            loopCount={state.trainer.loopCount}
            onLoopCount={actions.setLoopCount}
            stepMode={state.trainer.stepMode}
            onStepMode={actions.setStepMode}
            stepValue={state.trainer.stepValue}
            onStepValue={actions.setStepValue}
            selection={selectionText}
            onClearSelection={actions.clearSelection}
            parts={{
              loop: { "data-testid": "alphatab-trainer-loop-toggle" },
              loopCount: { "data-testid": "alphatab-trainer-loop-count" },
              step: { "data-testid": "alphatab-trainer-step-input" },
              stepMode: { "data-testid": "alphatab-trainer-step-mode" },
              clear: { "data-testid": "alphatab-loop-reset" },
            }}
          />
        </div>
      </Modal>

      <div className={`relative z-0 overflow-hidden bg-inherit ${viewportClass}`}>
        <div
          ref={host}
          className="alphatab-player-surface min-h-50 w-full overscroll-x-contain rounded-sm focus-visible:ring-2 focus-visible:ring-[rgba(55,55,255,0.35)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none [&_.at-cursor-bar]:bg-[rgba(55,55,255,0.15)] [&_.at-cursor-beat]:w-0.75 [&_.at-cursor-beat]:bg-[rgba(180,180,180,0.75)] [&_.at-cursor-beat]:[backdrop-filter:invert(80%)]"
          aria-label="Interactive notation player"
        />
      </div>
    </div>
  );
}
