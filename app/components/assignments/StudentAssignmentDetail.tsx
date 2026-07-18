import { Effect } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { getErrorMessage } from "../../lib/errors.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import type {
  AssignedMaterial,
  AssignmentProgress,
  AssignmentReview,
  Material,
  PracticeLog,
} from "../../../shared/schemas.js";
import { findNotationTrack, formatNotationTrackLabel } from "../../../shared/notationTracks.js";
import { MaterialPreview } from "../library/MaterialPreview.js";
import { categorize } from "../library/helpers.js";
import { Button } from "../ui/Button.js";

export function getAssignedTrackLabel(material: {
  notation_tracks: Material["notation_tracks"];
  assigned_track_index: number | null | undefined;
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
  return getErrorMessage(error, fallback);
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
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }, (_, index) => {
        const stars = index + 1;
        const active = value !== null && stars <= value;

        return (
          <button
            key={stars}
            type="button"
            onClick={() => onChange(stars)}
            disabled={disabled}
            className="cursor-pointer rounded-md p-1 transition-colors hover:bg-overlay/6 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-overlay-dark/6"
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
    <div className="flex items-center gap-1" aria-label={`${stars} out of 5 stars`}>
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
  const { user, isParent } = useAuth();
  const canTrackAssignments = user?.role === "student" || isParent;
  const queryClient = useQueryClient();
  const category = categorize(material.mime_type, material.original_filename);
  const [progress, setProgress] = useState<AssignmentProgress | null>(initialProgress);
  const [reviews, setReviews] = useState<AssignmentReview[]>(initialReviews);
  const [selectedStars, setSelectedStars] = useState<number | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [practiceRating, setPracticeRating] = useState<number | null>(null);
  const [ratingSaved, setRatingSaved] = useState(false);
  const unloggedPlaybackRef = useRef(0);
  const autoLoggedRef = useRef(false);

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
    setPracticeRating(null);
    unloggedPlaybackRef.current = 0;
    autoLoggedRef.current = false;
  }, [material.id]);

  const playbackMutation = useMutation({
    mutationFn: (seconds: number) =>
      Effect.runPromise(
        api.authenticated.recordAssignmentPlayback({
          path: { materialId: material.id },
          payload: { seconds },
        }),
      ),
    onSuccess: (data) => {
      setPlaybackError(null);
      setProgress(data);
    },
    onError: (error) => {
      setPlaybackError(mutationErrorMessage(error, "Failed to save playback time"));
    },
  });

  const reviewMutation = useMutation({
    mutationFn: (stars: number) =>
      Effect.runPromise(
        api.authenticated.createAssignmentReview({
          path: { materialId: material.id },
          payload: { stars },
        }),
      ),
    onSuccess: (data) => {
      setReviewError(null);
      setSelectedStars(null);
      setReviews((current) => [data, ...current]);
    },
    onError: (error) => {
      setReviewError(mutationErrorMessage(error, "Failed to save self-review"));
    },
  });

  const createLogMutation = useMutation({
    mutationFn: (durationMinutes: number) =>
      Effect.runPromise(
        api.authenticated.createPracticeLog({
          payload: {
            material_id: material.id,
            duration_minutes: durationMinutes,
          },
        }),
      ),
    onSuccess: () => {
      unloggedPlaybackRef.current = 0;
      autoLoggedRef.current = true;
      queryClient.invalidateQueries({ queryKey: ["practice-logs"] });
    },
  });

  const rateLogMutation = useMutation({
    mutationFn: (rating: number) =>
      Effect.runPromise(
        api.authenticated.ratePracticeLog({
          payload: { material_id: material.id, rating },
        }),
      ),
    onSuccess: () => {
      setRatingSaved(true);
      setPracticeRating(null);
      setTimeout(() => setRatingSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["practice-logs"] });
    },
  });

  const handleSessionEnd = useCallback(() => {
    if (!canTrackAssignments || autoLoggedRef.current) return;
    const seconds = unloggedPlaybackRef.current;
    if (seconds < 30) return;
    const minutes = Math.round(seconds / 60);
    if (minutes > 0) {
      createLogMutation.mutate(minutes);
    }
  }, [canTrackAssignments, createLogMutation]);

  const { data: practiceLogs = [] } = useQuery({
    queryKey: ["practice-logs", material.id],
    queryFn: () =>
      Effect.runPromise(
        api.authenticated.practiceLogs({ urlParams: { material_id: material.id } }),
      ),
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
                onDurationSeconds: (seconds: number) => {
                  setDurationSeconds((current) => (current === seconds ? current : seconds));
                },
                onPlaybackSeconds: (seconds: number) => {
                  if (!canTrackAssignments) return;
                  playbackMutation.mutate(seconds);
                  unloggedPlaybackRef.current += seconds;
                },
                onSessionEnd: handleSessionEnd,
              }
            : undefined
        }
      />

      <div className="px-6 py-6">
        {playbackError ? (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{playbackError}</p>
        ) : null}

        <div className="flex flex-col gap-2 text-sm text-muted md:flex-row md:items-center md:justify-between md:text-right dark:text-muted-dark">
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
          <div className="mt-4 flex flex-col gap-2">
            {reviews.map((review) => (
              <div
                key={review.id}
                className="rounded-lg border border-overlay/6 px-3 py-3 dark:border-overlay-dark/6"
              >
                <div className="flex items-center justify-between gap-3">
                  <StarsDisplay stars={review.stars} />
                  <span className="text-xs text-muted/60 dark:text-muted-dark/60">
                    {formatDate(review.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {canTrackAssignments ? (
          <div className="mt-6 border-t border-overlay/6 pt-4 dark:border-overlay-dark/6">
            <h4 className="mb-3 text-sm font-medium">Self-Assessment</h4>
            {ratingSaved ? (
              <p className="text-sm text-green-600 dark:text-green-400">Saved!</p>
            ) : (
              <RatingSelector
                value={practiceRating}
                onChange={(stars) => {
                  setPracticeRating(stars);
                  rateLogMutation.mutate(stars);
                }}
                disabled={rateLogMutation.isPending}
              />
            )}

            {practiceLogs.length > 0 ? (
              <div className="mt-4 flex flex-col gap-2">
                <h4 className="text-xs font-medium text-muted dark:text-muted-dark">
                  Practice History
                </h4>
                {practiceLogs.map((log: PracticeLog) => (
                  <div
                    key={log.id}
                    className="rounded-lg border border-overlay/6 px-3 py-2 dark:border-overlay-dark/6"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {log.rating != null ? (
                          <StarsDisplay stars={log.rating} />
                        ) : (
                          <span className="text-xs text-muted/60 dark:text-muted-dark/60">
                            &mdash;
                          </span>
                        )}
                        {log.duration_minutes != null ? (
                          <span className="text-xs text-muted dark:text-muted-dark">
                            {log.duration_minutes}m
                          </span>
                        ) : null}
                      </div>
                      <span className="text-xs text-muted/60 dark:text-muted-dark/60">
                        {formatDate(log.logged_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
