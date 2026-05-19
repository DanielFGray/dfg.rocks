import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import type {
  AssignedMaterial,
  AssignmentProgress,
  AssignmentReview,
  Material,
} from "../../lib/types.js";
import { findNotationTrack, formatNotationTrackLabel } from "../../../shared/notationTracks.js";
import { MaterialPreview } from "../library/MaterialPreview.js";
import { categorize } from "../library/helpers.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

export function getAssignedTrackLabel(material: {
  notation_tracks: Material["notation_tracks"];
  assigned_track_index: number | null;
}): string | null {
  const track = findNotationTrack(material.notation_tracks, material.assigned_track_index);

  return track ? formatNotationTrackLabel(track) : null;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${String(diffDays)} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours)}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
}

function mutationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill={filled ? "currentColor" : "none"}
      className={filled ? "text-amber-400" : "text-muted/40 dark:text-muted-dark/40"}
    >
      <path
        d="M10 2.5L12.318 7.196L17.5 7.949L13.75 11.603L14.635 16.761L10 14.324L5.365 16.761L6.25 11.603L2.5 7.949L7.682 7.196L10 2.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RatingSelector({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="gap-1 flex items-center">
      {Array.from({ length: 5 }, (_, index) => {
        const stars = index + 1;
        const active = value !== null && stars <= value;

        return (
          <button
            key={stars}
            type="button"
            onClick={() => onChange(stars)}
            disabled={disabled}
            className="rounded-md p-1 hover:bg-overlay/6 dark:hover:bg-overlay-dark/6 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Rate ${stars} out of 5`}
          >
            <StarIcon filled={active} />
          </button>
        );
      })}
    </div>
  );
}

function StarsDisplay({ stars }: { stars: number }) {
  return (
    <div className="gap-1 flex items-center" aria-label={`${stars} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, index) => (
        <StarIcon key={index} filled={index < stars} />
      ))}
    </div>
  );
}

export function StudentAssignmentDetail({
  material,
  initialProgress,
  initialReviews,
}: {
  material: AssignedMaterial;
  initialProgress: AssignmentProgress | null;
  initialReviews: AssignmentReview[];
}) {
  const { user } = useAuth();
  const canTrackAssignments = user?.role === "student";
  const category = categorize(material.mime_type, material.original_filename);
  const [progress, setProgress] = useState<AssignmentProgress | null>(initialProgress);
  const [reviews, setReviews] = useState<AssignmentReview[]>(initialReviews);
  const [selectedStars, setSelectedStars] = useState<number | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    setProgress(initialProgress);
  }, [initialProgress]);

  useEffect(() => {
    setReviews(initialReviews);
  }, [initialReviews]);

  useEffect(() => {
    setSelectedStars(null);
    setDurationSeconds(null);
    setPlaybackError(null);
    setReviewError(null);
  }, [material.id]);

  const playbackMutation = useMutation({
    mutationFn: async (seconds: number) => {
      const { data, error } = await api.assignments({ materialId: material.id }).playback.post({
        seconds,
      });
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to save playback time");
      }
      return data;
    },
    onSuccess: (data) => {
      setPlaybackError(null);
      setProgress(data);
    },
    onError: (error) => {
      setPlaybackError(mutationErrorMessage(error, "Failed to save playback time"));
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (stars: number) => {
      const { data, error } = await api.assignments({ materialId: material.id }).reviews.post({
        stars,
      });
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to save self-review");
      }
      return data;
    },
    onSuccess: (data) => {
      setReviewError(null);
      setSelectedStars(null);
      setReviews((current) => [data, ...current]);
    },
    onError: (error) => {
      setReviewError(mutationErrorMessage(error, "Failed to save self-review"));
    },
  });

  const listenedSeconds = progress?.listened_seconds ?? 0;
  const latestReview = reviews[0] ?? null;
  const reviewUnlocked =
    category !== "notation" ||
    reviews.length > 0 ||
    (durationSeconds !== null && listenedSeconds > durationSeconds);

  return (
    <>
      <MaterialPreview
        material={material}
        notationPlayerProps={
          category === "notation"
            ? {
                defaultTrackIndex: material.assigned_track_index,
                onDurationSeconds: (seconds) => {
                  setDurationSeconds((current) => (current === seconds ? current : seconds));
                },
                onPlaybackSeconds: (seconds) => {
                  if (!canTrackAssignments) return;
                  playbackMutation.mutate(seconds);
                },
              }
            : undefined
        }
      />

      <div className="px-6 py-6">
        {playbackError ? (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{playbackError}</p>
        ) : null}

        <div className="text-sm text-muted dark:text-muted-dark md:text-right gap-2 md:flex-row md:items-center md:justify-between flex flex-col">
          {latestReview
            ? `Latest ${latestReview.stars}/5 ${formatDate(latestReview.created_at)}`
            : category === "notation" && !reviewUnlocked
              ? null
              : "Rate your progress!"}
        </div>

        {canTrackAssignments ? (
          category === "notation" && !reviewUnlocked ? null : (
            <>
              <RatingSelector
                value={selectedStars}
                onChange={setSelectedStars}
                disabled={reviewMutation.isPending}
              />
              <Button
                variant="outline"
                className="px-3 py-1.5 text-xs"
                disabled={reviewMutation.isPending || selectedStars === null}
                onClick={() => {
                  if (selectedStars === null) return;
                  reviewMutation.mutate(selectedStars);
                }}
              >
                {reviewMutation.isPending ? "Saving..." : "Save Review"}
              </Button>

              {reviewError ? (
                <p className="mt-3 text-sm text-red-600 dark:text-red-400">{reviewError}</p>
              ) : null}
            </>
          )
        ) : (
          <p className="mt-4 text-sm text-muted dark:text-muted-dark">
            Self-reviews can only be recorded from the student account.
          </p>
        )}

        {reviews.length === 0 ? null : (
          <div className="mt-4 gap-2 flex flex-col">
            {reviews.map((review) => (
              <div
                key={review.id}
                className="rounded-lg border-overlay/6 px-3 py-3 dark:border-overlay-dark/6 border"
              >
                <div className="gap-3 flex items-center justify-between">
                  <StarsDisplay stars={review.stars} />
                  <span className="text-xs text-muted/60 dark:text-muted-dark/60">
                    {formatDate(review.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
