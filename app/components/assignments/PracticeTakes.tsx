import { useQuery } from "@tanstack/react-query";
import { practiceTakesQuery } from "../../lib/queries.js";
import type { PracticeTake } from "../../../shared/schemas.js";
import { formatDate } from "./StudentAssignmentDetail.js";

/** Negative offsets are early, positive late (practice_takes.mean_offset_ms). */
export function formatOffset(ms: number): string {
  const rounded = Math.round(Math.abs(ms));
  if (rounded === 0) return "on the beat";
  return `${String(rounded)} ms ${ms < 0 ? "early" : "late"}`;
}

/**
 * One student's saved Listen takes for a score, oldest first, with how % on time and the
 * average early/late offset moved across them. Renders nothing until a take exists.
 */
export function PracticeTakes({
  materialId,
  studentId,
}: {
  materialId: string;
  studentId: string;
}) {
  const { data: takes = [] } = useQuery(practiceTakesQuery(materialId, studentId));
  if (takes.length === 0) return null;

  return (
    <div data-testid="practice-takes" className="flex flex-col gap-2">
      <h4 className="text-xs font-medium text-muted">Click Takes</h4>
      {takes.length > 1 ? (
        <div className="flex gap-6" data-testid="practice-takes-trend">
          <Sparkline
            label="% on time"
            values={takes.map((take) => take.on_time_pct)}
            latest={`${String(Math.round(takes[takes.length - 1]!.on_time_pct))}%`}
            domain={[0, 100]}
          />
          <Sparkline
            label="Early / late"
            values={takes.map((take) => take.mean_offset_ms)}
            latest={formatOffset(takes[takes.length - 1]!.mean_offset_ms)}
          />
        </div>
      ) : null}
      {takes.map((take: PracticeTake) => (
        <div
          key={take.id}
          data-testid="practice-take"
          className="flex items-center justify-between gap-3 rounded-lg border border-overlay/6 px-3 py-2 text-xs"
        >
          <span>
            {Math.round(take.on_time_pct)}% on time · {formatOffset(take.mean_offset_ms)} ·{" "}
            {Math.round(take.bpm)} bpm
          </span>
          <span className="text-muted/60">{formatDate(take.taken_at)}</span>
        </div>
      ))}
    </div>
  );
}

const WIDTH = 120;
const HEIGHT = 32;

function Sparkline({
  label,
  values,
  latest,
  domain,
}: {
  label: string;
  values: number[];
  latest: string;
  domain?: [number, number];
}) {
  const [min, max] = domain ?? [Math.min(...values, 0), Math.max(...values, 0)];
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * WIDTH;
      const y = HEIGHT - ((value - min) / span) * HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="flex flex-col gap-1 text-xs text-muted">
      <span>
        {label}: {latest}
      </span>
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        role="img"
        aria-label={`${label} over time`}
        className="text-accent"
      >
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </div>
  );
}
