import { useRef, useState } from "react";
import type {
  ContentVisibility,
  Material,
  MaterialNotationTrack,
} from "../../../shared/schemas.js";
import {
  formatNotationTrackLabel,
  toMaterialNotationTrack,
} from "../../../shared/notationTracks.js";
import { getErrorMessage } from "../../lib/errors.js";
import { visibilityOptions } from "../../lib/visibility.js";
import { Input } from "../ui/Input.js";
import { Select } from "../ui/Select.js";
import { Button } from "../ui/Button.js";
import {
  categoryLabel,
  categorize,
  formatSize,
  getUploadMaterialTitle,
  isNotation,
} from "./helpers.js";

type UploadItemStatus = "idle" | "uploading" | "success" | "error";

type UploadItem = {
  id: string;
  file: File;
  title: string;
  titleError: string | null;
  titleWasEdited: boolean;
  notationTracks: MaterialNotationTrack[] | null;
  isInspectingTracks: boolean;
  trackInspectionError: string | null;
  uploadStatus: UploadItemStatus;
  uploadError: string | null;
};

function dedupeMaterials(materials: Material[]): Material[] {
  const seen = new Set<string>();
  return materials.filter((material) => {
    if (seen.has(material.id)) {
      return false;
    }
    seen.add(material.id);
    return true;
  });
}

export function UploadMaterialForm({
  onUpload,
  onComplete,
  onCancel,
}: {
  onUpload: (file: File, title: string, visibility: ContentVisibility) => Promise<Material>;
  onComplete?: (materials: Material[], hadErrors: boolean) => void;
  onCancel: () => void;
}) {
  const nextItemIdRef = useRef(0);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<ContentVisibility>("course");

  const createUploadItem = (file: File): UploadItem => ({
    id: `material-upload-${nextItemIdRef.current++}`,
    file,
    title: getUploadMaterialTitle(file.name, null),
    titleError: null,
    titleWasEdited: false,
    notationTracks: null,
    isInspectingTracks: false,
    trackInspectionError: null,
    uploadStatus: "idle",
    uploadError: null,
  });

  const inspectFile = async (itemId: string, file: File) => {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              notationTracks: null,
              trackInspectionError: null,
              isInspectingTracks: isNotation(file.name),
            }
          : item,
      ),
    );

    if (!isNotation(file.name)) {
      return;
    }

    try {
      const { importer } = await import("@coderline/alphatab");
      const score = importer.ScoreLoader.loadScoreFromBytes(
        new Uint8Array(await file.arrayBuffer()),
      );

      setItems((current) =>
        current.map((item) =>
          item.id === itemId
            ? {
                ...item,
                isInspectingTracks: false,
                notationTracks: score.tracks.map(toMaterialNotationTrack),
                title: item.titleWasEdited
                  ? item.title
                  : getUploadMaterialTitle(file.name, score.title),
              }
            : item,
        ),
      );
    } catch (error) {
      setItems((current) =>
        current.map((item) =>
          item.id === itemId
            ? {
                ...item,
                isInspectingTracks: false,
                trackInspectionError: getErrorMessage(
                  error,
                  "Couldn't inspect tracks for this notation file.",
                ),
              }
            : item,
        ),
      );
    }
  };

  const handleFilesChange = (files: FileList | null) => {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) {
      return;
    }

    const nextItems = selectedFiles.map(createUploadItem);
    setFormError(null);
    setItems((current) => [...current, ...nextItems]);
    for (const item of nextItems) {
      void inspectFile(item.id, item.file);
    }
  };

  const handleTitleChange = (itemId: string, value: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              title: value,
              titleError: null,
              titleWasEdited: true,
            }
          : item,
      ),
    );
  };

  const handleRemove = (itemId: string) => {
    setItems((current) => current.filter((item) => item.id !== itemId));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const itemsToUpload = items.filter((item) => item.uploadStatus !== "success");

    if (itemsToUpload.length === 0) {
      setFormError("Select at least one file to upload.");
      return;
    }

    const invalidItemIds = new Set(
      itemsToUpload.filter((item) => item.title.trim().length === 0).map((item) => item.id),
    );

    if (invalidItemIds.size > 0) {
      setItems((current) =>
        current.map((item) =>
          invalidItemIds.has(item.id) ? { ...item, titleError: "Title is required." } : item,
        ),
      );
      return;
    }

    setFormError(null);
    setIsSubmitting(true);

    const itemIds = new Set(itemsToUpload.map((item) => item.id));
    setItems((current) =>
      current.map((item) =>
        itemIds.has(item.id)
          ? {
              ...item,
              titleError: null,
              uploadError: null,
              uploadStatus: "idle",
            }
          : item,
      ),
    );

    const successfulMaterials: Material[] = [];
    let hadErrors = false;

    for (const item of itemsToUpload) {
      setItems((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id
            ? {
                ...currentItem,
                uploadStatus: "uploading",
                uploadError: null,
              }
            : currentItem,
        ),
      );

      try {
        const material = await onUpload(item.file, item.title.trim(), visibility);
        successfulMaterials.push(material);
        setItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id
              ? {
                  ...currentItem,
                  uploadStatus: "success",
                  uploadError: null,
                }
              : currentItem,
          ),
        );
      } catch (error) {
        hadErrors = true;
        setItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id
              ? {
                  ...currentItem,
                  uploadStatus: "error",
                  uploadError: getErrorMessage(error, "Upload failed."),
                }
              : currentItem,
          ),
        );
      }
    }

    setIsSubmitting(false);
    onComplete?.(dedupeMaterials(successfulMaterials), hadErrors);
  };

  const pendingCount = items.filter((item) => item.uploadStatus !== "success").length;
  const isInspectingTracks = items.some((item) => item.isInspectingTracks);
  const submitLabel = isSubmitting
    ? "Uploading..."
    : pendingCount === 1
      ? "Upload 1 file"
      : `Upload ${pendingCount} files`;

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="upload-material-form"
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-2">
        <label
          htmlFor="material-files"
          className="text-sm font-medium text-muted"
        >
          Files
        </label>
        <input
          id="material-files"
          type="file"
          multiple
          disabled={isSubmitting}
          onChange={(e) => {
            handleFilesChange(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
          className="rounded-lg border border-overlay/10 bg-card px-4 py-3 text-primary outline-hidden transition-colors file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-accent/20 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-accent hover:file:bg-accent/30 focus:border-accent focus:ring-1 focus:ring-accent/50"
        />
        <p className="text-sm text-muted">
          Select one or more files, then review the generated titles before uploading.
        </p>
      </div>

      <Select
        id="material-visibility"
        name="visibility"
        label="Who can read"
        options={visibilityOptions}
        value={visibility}
        disabled={isSubmitting}
        onChange={(value) => setVisibility(value as ContentVisibility)}
      />

      {formError ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}

      {items.length > 0 ? (
        <div className="flex max-h-[28rem] flex-col gap-4 overflow-y-auto pr-1">
          {items.map((item) => {
            const fileCategory = categoryLabel[categorize(item.file.type, item.file.name)];

            return (
              <div
                key={item.id}
                data-testid="upload-material-row"
                className="rounded-xl border border-overlay/6 bg-card px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-primary">
                      {item.file.name}
                    </p>
                    <p className="text-xs text-muted">
                      {fileCategory} • {formatSize(item.file.size)}
                    </p>
                  </div>
                  {item.uploadStatus === "success" ? (
                    <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Uploaded
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => handleRemove(item.id)}
                      disabled={isSubmitting}
                      className="shrink-0 px-3 py-2"
                    >
                      Remove
                    </Button>
                  )}
                </div>

                <div className="mt-4">
                  <Input
                    id={`material-title-${item.id}`}
                    name={`title-${item.id}`}
                    label="Title"
                    value={item.title}
                    onChange={(value) => handleTitleChange(item.id, value)}
                    required
                    disabled={isSubmitting || item.uploadStatus === "success"}
                    placeholder="e.g. Scales Reference Sheet"
                    error={item.titleError ?? undefined}
                  />
                </div>

                {item.uploadStatus === "uploading" ? (
                  <p className="mt-3 text-sm text-accent">Uploading...</p>
                ) : null}
                {item.uploadStatus === "error" ? (
                  <p className="mt-3 text-sm text-red-600 dark:text-red-400">{item.uploadError}</p>
                ) : null}
                {item.isInspectingTracks ? (
                  <p className="mt-3 text-sm text-muted">
                    Inspecting notation tracks...
                  </p>
                ) : null}
                {item.notationTracks && item.notationTracks.length > 0 ? (
                  <div className="mt-3 rounded-lg border border-overlay/6 bg-surface px-4 py-3 text-sm">
                    <p className="font-medium text-primary">
                      Detected {item.notationTracks.length} track
                      {item.notationTracks.length === 1 ? "" : "s"}
                    </p>
                    <ul className="mt-2 space-y-1 text-muted">
                      {item.notationTracks.map((track) => (
                        <li key={track.index}>{formatNotationTrackLabel(track)}</li>
                      ))}
                    </ul>
                    {item.notationTracks.length > 1 ? (
                      <p className="mt-2 text-xs text-muted/70">
                        If this material is assigned directly to a student later, you&apos;ll choose
                        the assigned track then.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {item.trackInspectionError ? (
                  <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
                    Couldn&apos;t inspect notation tracks before upload: {item.trackInspectionError}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-overlay/10 px-4 py-8 text-center text-sm text-muted">
          No files selected yet.
        </div>
      )}

      {isInspectingTracks ? (
        <p className="text-sm text-muted">
          Finish inspecting notation files before uploading.
        </p>
      ) : null}

      <div className="mt-2 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={isSubmitting || isInspectingTracks || pendingCount === 0}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
