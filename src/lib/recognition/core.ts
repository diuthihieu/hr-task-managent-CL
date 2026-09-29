// Shared (client + server) recognition constants and period helpers.

export const POINT_ACTIONS = [
  "task_completed",
  "task_on_time",
  "task_created",
  "comment_posted",
  "helped_colleague",
  "kudos_received",
  "kudos_sent",
  "wiki_page_created",
  "decision_recorded",
  "focus_hour",
  "approval_given",
] as const;
export type PointActionName = (typeof POINT_ACTIONS)[number];

/** Default points per action (a workspace starts with these; admins change them). */
export const DEFAULT_POINTS: Record<PointActionName, number> = {
  task_completed: 10,
  task_on_time: 5,
  task_created: 2,
  comment_posted: 1,
  helped_colleague: 3,
  kudos_received: 15,
  kudos_sent: 2,
  wiki_page_created: 5,
  decision_recorded: 3,
  focus_hour: 4,
  approval_given: 2,
};

export const KUDOS_STYLES = ["gratitude", "appreciation", "teamwork", "above_beyond", "mentor"] as const;
export type KudosStyleName = (typeof KUDOS_STYLES)[number];

export const LEADERBOARD_METRICS = ["points", "tasks", "hours", "kudos"] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

export type PeriodKind = "week" | "month" | "quarter" | "year" | "custom";

/** [from, to) of the period containing `now` (UTC days), or the custom range (inclusive end date). */
export function periodRange(kind: PeriodKind, now = new Date(), from?: string, to?: string): { from: Date; to: Date } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (kind === "custom") {
    const f = from ? new Date(`${from}T00:00:00Z`) : new Date(d.getTime() - 29 * 86400000);
    const t = to ? new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000) : new Date(d.getTime() + 86400000);
    return { from: f, to: t };
  }
  if (kind === "week") {
    const start = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
    return { from: start, to: new Date(start.getTime() + 7 * 86400000) };
  }
  if (kind === "month") return { from: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), to: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) };
  if (kind === "quarter") {
    const q = Math.floor(d.getUTCMonth() / 3) * 3;
    return { from: new Date(Date.UTC(d.getUTCFullYear(), q, 1)), to: new Date(Date.UTC(d.getUTCFullYear(), q + 3, 1)) };
  }
  return { from: new Date(Date.UTC(d.getUTCFullYear(), 0, 1)), to: new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1)) };
}
