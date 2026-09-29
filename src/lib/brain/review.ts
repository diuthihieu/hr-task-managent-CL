/** Spaced-review intervals (days) by stage. */
export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30, 60, 120];

export function nextReviewDate(from: Date, stage: number): Date {
  const days = REVIEW_INTERVALS_DAYS[Math.max(0, Math.min(stage, REVIEW_INTERVALS_DAYS.length - 1))];
  return new Date(from.getTime() + days * 86400000);
}
