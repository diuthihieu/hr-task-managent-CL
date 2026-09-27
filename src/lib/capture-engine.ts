// Put All Things On - dot visualization math. A captured thought's exact
// `plannedAt` (or its absence) is bucketed into a concentric time ring so the
// canvas stays a handful of legible bands instead of a literal timeline; the
// bucket boundaries are computed from the real gap-to-now, not a manually
// chosen enum, so the rings stay accurate as time passes.

export const TIME_BUCKETS = ["today", "this_week", "next", "later", "unscheduled"] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];

export const TIME_BUCKET_LABELS: Record<TimeBucket, string> = {
  today: "Today",
  this_week: "This Week",
  next: "Next",
  later: "Later",
  unscheduled: "Unplanned",
};

/** Normalized radial distance (0-1) of each ring's boundary from the "Now" center; unscheduled dots sit outside the outermost ring. */
export const TIME_BUCKET_DISTANCE: Record<TimeBucket, number> = {
  today: 0.22,
  this_week: 0.48,
  next: 0.72,
  later: 0.92,
  unscheduled: 1.18,
};

export function bucketForPlannedAt(plannedAt: string | null | undefined): TimeBucket {
  if (!plannedAt) return "unscheduled";
  const diffDays = (new Date(plannedAt).getTime() - Date.now()) / 86400000;
  if (diffDays <= 1) return "today";
  if (diffDays <= 7) return "this_week";
  if (diffDays <= 14) return "next";
  return "later";
}

/** Dot radius in px from an estimated duration in minutes - sqrt-scaled so a 4h task isn't absurdly larger than a 15m one. */
export function dotRadiusForDuration(minutes: number | null | undefined): number {
  const m = minutes ?? 30;
  const MIN_R = 7;
  const MAX_R = 22;
  const scaled = MIN_R + (Math.sqrt(Math.min(m, 8 * 60)) / Math.sqrt(8 * 60)) * (MAX_R - MIN_R);
  return Math.round(scaled);
}
