import { useRef, useState } from "react";
import type { MaterialNotationTrack } from "../../lib/types.js";
import {
  formatNotationTrackLabel,
  toMaterialNotationTrack,
} from "../../../shared/notationTracks.js";
import { Input } from "../ui/Input.js";
import { Button } from "../ui/Button.js";
import { isNotation } from "./helpers.js";

export function UploadMaterialForm({
  onSubmit,
  onCancel,
  isPending,
}: {
  onSubmit: (file: File, title: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}) {
  const inspectionIdRef = useRef(0);
  const [notationTracks, setNotationTracks] = useState<MaterialNotationTrack[] | null>(null);
  const [isInspectingTracks, setIsInspectingTracks] = useState(false);
  const [trackInspectionError, setTrackInspectionError] = useState<string | null>(null);

  const handleFileChange = async (file: File | null) => {
    const inspectionId = inspectionIdRef.current + 1;
    inspectionIdRef.current = inspectionId;

    setNotationTracks(null);
    setTrackInspectionError(null);

    if (!file || !isNotation(file.name)) {
      setIsInspectingTracks(false);
      return;
    }

    setIsInspectingTracks(true);

    try {
      const { importer } = await import("@coderline/alphatab");
      const score = importer.ScoreLoader.loadScoreFromBytes(
        new Uint8Array(await file.arrayBuffer()),
      );

      if (inspectionIdRef.current !== inspectionId) {
        return;
      }

      setNotationTracks(score.tracks.map(toMaterialNotationTrack));
    } catch (error) {
      if (inspectionIdRef.current !== inspectionId) {
        return;
      }

      setTrackInspectionError(
        error instanceof Error ? error.message : "Couldn't inspect tracks for this notation file.",
      );
    } finally {
      if (inspectionIdRef.current === inspectionId) {
        setIsInspectingTracks(false);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const title = data.get("title");
    if (!file || !(file instanceof File) || typeof title !== "string") return;
    onSubmit(file, title);
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="upload-material-form"
      className="gap-5 flex flex-col"
    >
      <Input
        id="material-title"
        name="title"
        label="Title"
        required
        placeholder="e.g. Scales Reference Sheet"
      />
      <div className="gap-1.5 flex flex-col">
        <label
          htmlFor="material-file"
          className="text-sm font-medium text-muted dark:text-muted-dark"
        >
          File
        </label>
        <input
          id="material-file"
          name="file"
          type="file"
          required
          onChange={(e) => void handleFileChange(e.currentTarget.files?.[0] ?? null)}
          className="rounded-lg border-overlay/10 bg-card px-4 py-3 text-primary file:mr-4 file:rounded-lg file:bg-accent/20 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-accent hover:file:bg-accent/30 focus:border-accent focus:ring-accent/50 dark:border-overlay-dark/10 dark:bg-card-dark dark:text-primary-dark border transition-colors outline-hidden file:cursor-pointer file:border-0 focus:ring-1"
        />
        {isInspectingTracks ? (
          <p className="text-sm text-muted dark:text-muted-dark">Inspecting notation tracks...</p>
        ) : null}
        {notationTracks && notationTracks.length > 0 ? (
          <div className="rounded-lg border-overlay/6 bg-card px-4 py-3 text-sm dark:border-overlay-dark/6 dark:bg-card-dark border">
            <p className="font-medium text-primary dark:text-primary-dark">
              Detected {notationTracks.length} track
              {notationTracks.length === 1 ? "" : "s"}
            </p>
            <ul className="mt-2 space-y-1 text-muted dark:text-muted-dark">
              {notationTracks.map((track) => (
                <li key={track.index}>{formatNotationTrackLabel(track)}</li>
              ))}
            </ul>
            {notationTracks.length > 1 ? (
              <p className="mt-2 text-xs text-muted/70 dark:text-muted-dark/70">
                If this material is assigned directly to a student later, you&apos;ll choose the
                assigned track then.
              </p>
            ) : null}
          </div>
        ) : null}
        {trackInspectionError ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Couldn&apos;t inspect notation tracks before upload: {trackInspectionError}
          </p>
        ) : null}
      </div>
      <div className="mt-2 gap-3 flex justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isPending || isInspectingTracks}>
          {isPending ? "Uploading..." : "Upload"}
        </Button>
      </div>
    </form>
  );
}
