// Put All Things On needs to write a clarified thought into whatever
// "Task Name / Category / Status / ..." fields a table actually has, without
// hardcoding field ids (every workspace's task table has its own field ids).
// Each conceptual role resolves through field-roles.ts (explicit role, then
// bilingual name match, then first field of a compatible type) - so a table
// just needs a Category-like field to be capturable, everything else degrades
// gracefully if absent.

import { findFieldByRole } from "./field-roles";
import type { FieldRow } from "@/types";

export interface CaptureFieldRoles {
  primaryField: FieldRow | null;
  categoryField: FieldRow | null;
  durationField: FieldRow | null; // number-like, hours
  startField: FieldRow | null;
  dueField: FieldRow | null;
  statusField: FieldRow | null;
  priorityField: FieldRow | null;
  outputField: FieldRow | null; // long_text
  processField: FieldRow | null; // long_text
  ownerField: FieldRow | null; // person
  objectiveField: FieldRow | null; // okr_objective
  keyResultField: FieldRow | null; // okr_key_result
}

export function detectCaptureFieldRoles(fields: FieldRow[]): CaptureFieldRoles {
  const primaryField = fields.find((f) => f.isPrimary) ?? null;
  const categoryField = findFieldByRole(fields, "category", { fallbackToType: true });
  const statusField = findFieldByRole(fields, "status", { exclude: [categoryField], fallbackToType: true });
  const priorityField = findFieldByRole(fields, "priority", { exclude: [categoryField, statusField], fallbackToType: true });
  const durationField = findFieldByRole(fields, "duration", { fallbackToType: true });
  const startField = findFieldByRole(fields, "start_date", { fallbackToType: true });
  const dueField = findFieldByRole(fields, "due_date", { exclude: [startField], fallbackToType: true });
  const outputField = findFieldByRole(fields, "output", { fallbackToType: true });
  const processField = findFieldByRole(fields, "process", { exclude: [outputField], fallbackToType: true });
  const ownerField = findFieldByRole(fields, "owner", { fallbackToType: true });
  const objectiveField = fields.find((f) => f.type === "okr_objective") ?? null;
  const keyResultField = fields.find((f) => f.type === "okr_key_result") ?? null;

  return {
    primaryField,
    categoryField,
    durationField,
    startField,
    dueField,
    statusField,
    priorityField,
    outputField,
    processField,
    ownerField,
    objectiveField,
    keyResultField,
  };
}

// ---------------------------------------------------------------------------
// Put All Things On - dot visualization math. A captured thought's exact
// `plannedAt` (or its absence) is bucketed into a concentric time ring so the
// canvas stays a handful of legible bands instead of a literal timeline; the
// bucket boundaries are computed from the real gap-to-now, not a manually
// chosen enum, so the rings stay accurate as time passes.
// ---------------------------------------------------------------------------

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
