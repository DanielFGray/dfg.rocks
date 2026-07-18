import {
  Button,
  DialogTrigger,
  Popover,
  Dialog,
  Slider,
  SliderTrack,
  SliderThumb,
  Label,
} from "react-aria-components";

interface VolumeControlProps {
  volume: number;
  disabled: boolean;
  onVolumeChange: (volume: number) => void;
}

export function VolumeControl({ volume, disabled, onVolumeChange }: VolumeControlProps) {
  const percentage = Math.round(volume * 100);

  return (
    <DialogTrigger>
      <Button
        isDisabled={disabled}
        aria-label={`Track volume ${percentage}%`}
        data-testid="alphatab-track-volume-button"
        className="flex items-center justify-center rounded-full bg-overlay/10 p-1.5 text-primary transition-colors hover:bg-overlay/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-overlay-dark/10 dark:text-primary-dark dark:hover:bg-overlay-dark/20"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 3.75a.75.75 0 00-1.264-.546L5.203 6H2.667a.75.75 0 00-.7.48A6.985 6.985 0 001.5 10c0 1.252.328 2.429.906 3.45a.75.75 0 00.761.55h2.036l3.533 2.796A.75.75 0 0010 16.25V3.75zM15.95 5.05a.75.75 0 00-1.06 1.061 5.5 5.5 0 010 7.778.75.75 0 001.06 1.06 7 7 0 000-9.899z" />
          <path d="M13.829 7.172a.75.75 0 00-1.061 1.06 2.5 2.5 0 010 3.536.75.75 0 001.06 1.06 4 4 0 000-5.656z" />
        </svg>
      </Button>
      <Popover
        placement="bottom end"
        className="data-[entering]:animate-in data-[entering]:fade-in data-[entering]:slide-in-from-top-1 data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:slide-out-to-top-1 rounded-xl border border-overlay/10 bg-card/95 shadow-2xl backdrop-blur-md dark:border-overlay-dark/10 dark:bg-card-dark/95"
      >
        <Dialog aria-label="Track volume" className="outline-hidden">
          <Slider
            value={volume}
            onChange={onVolumeChange}
            isDisabled={disabled}
            orientation="vertical"
            minValue={0}
            maxValue={1}
            step={0.05}
            className="flex h-28 flex-col items-center gap-2 px-3 py-3"
          >
            <Label className="text-[11px] font-medium text-muted dark:text-muted-dark">Track</Label>
            <SliderTrack className="group relative w-5 flex-1 cursor-pointer">
              <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-overlay/20" />
              <div
                className="absolute bottom-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-[rgb(190,117,48)]"
                style={{ height: `${volume * 100}%` }}
              />
              <SliderThumb
                data-testid="alphatab-track-volume-slider"
                className="top-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-[rgb(190,117,48)] bg-white data-dragging:bg-[rgb(190,117,48)] data-focus-visible:ring-2 data-focus-visible:ring-[rgb(190,117,48)]"
                style={{ top: `${(1 - volume) * 100}%` }}
              />
            </SliderTrack>
            <span className="text-[11px] text-muted dark:text-muted-dark">{percentage}%</span>
          </Slider>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
