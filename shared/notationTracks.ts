import type { MaterialNotationTrack } from "./schemas.js";

type NotationTrackInput = {
  index?: unknown;
  name?: unknown;
  shortName?: unknown;
  short_name?: unknown;
  isPercussion?: unknown;
  is_percussion?: unknown;
};

function toTrackIndex(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toTrackText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function toMaterialNotationTrack(track: NotationTrackInput): MaterialNotationTrack {
  const index = toTrackIndex(track.index);
  const name = toTrackText(track.name) ?? toTrackText(track.shortName) ?? `Track ${index + 1}`;
  const shortName =
    toTrackText(track.short_name) ??
    toTrackText(track.shortName) ??
    toTrackText(track.name) ??
    name;

  return {
    index,
    name,
    short_name: shortName,
    is_percussion:
      typeof track.is_percussion === "boolean" ? track.is_percussion : Boolean(track.isPercussion),
  };
}

export function formatNotationTrackLabel(track: MaterialNotationTrack): string {
  return track.short_name && track.short_name !== track.name
    ? `${track.name} (${track.short_name})`
    : track.name;
}

export function findNotationTrack(
  notationTracks: readonly MaterialNotationTrack[] | null | undefined,
  assignedTrackIndex: number | null | undefined,
): MaterialNotationTrack | null {
  if (!notationTracks || notationTracks.length === 0) {
    return null;
  }

  if (assignedTrackIndex === null || assignedTrackIndex === undefined) {
    return notationTracks.length === 1 ? (notationTracks[0] ?? null) : null;
  }

  return notationTracks.find((track) => track.index === assignedTrackIndex) ?? null;
}
