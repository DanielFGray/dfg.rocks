import { importer } from "@coderline/alphatab";
import type { MaterialNotationTrack } from "../../shared/schemas.js";
import { toMaterialNotationTrack } from "../../shared/notationTracks.js";
import { rootDb } from "../db.js";
import { HttpError } from "../pgErrors.js";

const NOTATION_EXTENSIONS = new Set([".gp", ".gp3", ".gp4", ".gp5", ".gpx", ".musicxml", ".mxl"]);

function isNotationFilename(filename: string): boolean {
  const normalized = filename.toLowerCase();
  return [...NOTATION_EXTENSIONS].some((extension) => normalized.endsWith(extension));
}

function parseTrackIndex(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  return null;
}

function isMaterialNotationTrack(value: unknown): value is MaterialNotationTrack {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.index === "number" &&
    typeof candidate.name === "string" &&
    typeof candidate.short_name === "string" &&
    typeof candidate.is_percussion === "boolean"
  );
}

function normalizeNotationTracks(value: unknown): MaterialNotationTrack[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const tracks = value.filter(isMaterialNotationTrack);
  return tracks.length > 0 ? tracks : null;
}

export function extractNotationTracksFromBytes(
  bytes: Uint8Array,
  filename: string,
): MaterialNotationTrack[] | null {
  if (!isNotationFilename(filename)) {
    return null;
  }

  try {
    const score = importer.ScoreLoader.loadScoreFromBytes(bytes);
    const tracks = Array.isArray(score.tracks) ? score.tracks.map(toMaterialNotationTrack) : [];
    return tracks.length > 0 ? tracks : null;
  } catch {
    return null;
  }
}

export async function resolveAssignedTrackIndex(
  materialId: string,
  assignedTrackIndex: number | string | null | undefined,
): Promise<number | null> {
  const material = await rootDb
    .selectFrom("app_public.materials")
    .select(["id", "notation_tracks"])
    .where("id", "=", materialId)
    .executeTakeFirst();

  if (!material) {
    throw new HttpError(404, "Material not found");
  }

  const tracks = normalizeNotationTracks(material.notation_tracks);
  const normalizedAssignedTrackIndex = parseTrackIndex(assignedTrackIndex);

  if (!tracks) {
    if (normalizedAssignedTrackIndex !== null) {
      throw new HttpError(400, "This material does not have notation tracks");
    }
    return null;
  }

  if (tracks.length === 1) {
    const onlyTrackIndex = tracks[0]!.index;
    if (
      normalizedAssignedTrackIndex !== null &&
      normalizedAssignedTrackIndex !== onlyTrackIndex
    ) {
      throw new HttpError(400, "Invalid assigned track");
    }
    return onlyTrackIndex;
  }

  if (normalizedAssignedTrackIndex === null) {
    throw new HttpError(400, "Choose a track for multi-track notation material");
  }

  const assignedTrack = tracks.find((track) => track.index === normalizedAssignedTrackIndex);
  if (!assignedTrack) {
    throw new HttpError(400, "Invalid assigned track");
  }

  return assignedTrack.index;
}
