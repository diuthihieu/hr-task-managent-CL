// OKR progress math, shared by every API route that reads Objectives/Key
// Results. Progress is never stored - it's recomputed here every time from
// (a) a task-based KR's linked tasks, or (b) a numeric/percentage/manual KR's
// own value fields - so a Task edit is reflected the instant it's read back,
// with nothing to keep in sync and no write-fanout.

import { parseFieldConfig } from "./field-types";
import { findFieldByRole, isDoneLabel } from "./field-roles";
import type { FieldRow } from "@/types";

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

/** A task record's own completion percentage, read from whichever field on its table represents progress. */
export function resolveTaskProgress(fields: FieldRow[], data: Record<string, unknown>): number {
  const progressField = fields.find((f) => f.type === "progress");
  if (progressField) {
    const v = Number(data[progressField.id]);
    return Number.isFinite(v) ? clamp(v) : 0;
  }
  const statusField = findFieldByRole(fields, "status");
  if (statusField) {
    const cfg = parseFieldConfig(statusField.config);
    const label = cfg.options?.find((o) => o.id === data[statusField.id])?.label ?? "";
    return isDoneLabel(label) ? 100 : 0;
  }
  const checkboxField = fields.find((f) => f.type === "checkbox");
  if (checkboxField) return data[checkboxField.id] ? 100 : 0;
  return 0;
}

/** A task's contribution weight toward its linked Key Result - the "OKR Contribution Weight" percent field if present, else equal weight (1). */
export function resolveTaskOkrWeight(fields: FieldRow[], data: Record<string, unknown>): number {
  const weightField = fields.find((f) => f.type === "percent" && f.name.trim().toLowerCase() === "okr contribution weight");
  if (!weightField) return 1;
  const v = Number(data[weightField.id]);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export interface KeyResultValueShape {
  type: string;
  startValue: number;
  targetValue: number;
  currentValue: number;
  manualProgress: number | null;
}

export function computeKeyResultProgress(kr: KeyResultValueShape, taskProgresses: { progress: number; weight: number }[]): number {
  if (kr.type === "manual") return clamp(kr.manualProgress ?? 0);
  if (kr.type === "percentage") return clamp(kr.currentValue);
  if (kr.type === "numeric") {
    const span = kr.targetValue - kr.startValue;
    if (span === 0) return kr.currentValue >= kr.targetValue ? 100 : 0;
    return clamp(((kr.currentValue - kr.startValue) / span) * 100);
  }
  // task_based (default)
  if (!taskProgresses.length) return 0;
  const totalWeight = taskProgresses.reduce((s, t) => s + t.weight, 0);
  if (totalWeight <= 0) return 0;
  const sum = taskProgresses.reduce((s, t) => s + t.progress * t.weight, 0);
  return clamp(sum / totalWeight);
}

export function computeObjectiveProgress(keyResults: { progress: number; weight: number }[]): number {
  if (!keyResults.length) return 0;
  const totalWeight = keyResults.reduce((s, k) => s + k.weight, 0);
  if (totalWeight <= 0) return clamp(keyResults.reduce((s, k) => s + k.progress, 0) / keyResults.length);
  return clamp(keyResults.reduce((s, k) => s + k.progress * k.weight, 0) / totalWeight);
}

/** Due-date-derived urgency, for the Eisenhower matrix's optional auto-urgency rule. */
export function deriveUrgencyFromDueDate(dueDate: string | null | undefined, withinDays: number): "urgent" | "not_urgent" {
  if (!dueDate) return "not_urgent";
  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return "not_urgent";
  const now = Date.now();
  const days = (due - now) / 86400000;
  return days <= withinDays ? "urgent" : "not_urgent";
}
