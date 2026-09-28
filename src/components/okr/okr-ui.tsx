"use client";
import { useState } from "react";
import { AlertTriangle, Circle } from "lucide-react";
import { initials, cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";
import type { ObjectiveStatus, OkrPriority, OkrUserLite } from "@/types";

export const STATUS_META: Record<ObjectiveStatus, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "#94a3b8" },
  on_track: { label: "On Track", color: "#22c55e" },
  at_risk: { label: "At Risk", color: "#eab308" },
  off_track: { label: "Off Track", color: "#ef4444" },
  completed: { label: "Completed", color: "#6366f1" },
};

export const PRIORITY_META: Record<OkrPriority, { label: string; color: string }> = {
  low: { label: "Low", color: "#94a3b8" },
  medium: { label: "Medium", color: "#3b82f6" },
  high: { label: "High", color: "#f97316" },
  critical: { label: "Critical", color: "#ef4444" },
};

export function ProgressBar({ value, color = "#6366f1", height = 6 }: { value: number; color?: string; height?: number }) {
  return (
    <div className="flex-1 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden" style={{ height }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }} />
    </div>
  );
}

export function StatusBadge({ status }: { status: ObjectiveStatus | string }) {
  const { t } = useT();
  const base = STATUS_META[status as ObjectiveStatus];
  const meta = base ? { ...base, label: t(`okr.status.${status}` as MessageKey) } : { label: status, color: "#94a3b8" };
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}>
      <Circle size={6} fill={meta.color} className="shrink-0" style={{ color: meta.color }} />
      {meta.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: OkrPriority | string }) {
  const { t } = useT();
  const base = PRIORITY_META[priority as OkrPriority];
  const meta = base ? { ...base, label: t(`okr.priority.${priority}` as MessageKey) } : { label: priority, color: "#94a3b8" };
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}>
      {meta.label}
    </span>
  );
}

export function ConfidenceDot({ confidence }: { confidence: number }) {
  const { t } = useT();
  const color = confidence >= 70 ? "#22c55e" : confidence >= 40 ? "#eab308" : "#ef4444";
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500 shrink-0" title={t("okr.confidence", { value: confidence })}>
      {confidence < 40 && <AlertTriangle size={11} style={{ color }} />}
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {t("okr.confShort")} {confidence}%
    </span>
  );
}

/** A percentage that always says what it measures (never a bare "45%"). */
export function PctLabel({ label, value, className, strong }: { label: string; value: number; className?: string; strong?: boolean }) {
  return (
    <span className={`inline-flex items-baseline gap-1 shrink-0 tabular-nums ${className ?? ""}`}>
      <span className="text-[10px] text-neutral-400 font-normal">{label}</span>
      <span className={strong ? "font-semibold text-neutral-800 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-300"}>{Math.round(value)}%</span>
    </span>
  );
}

export function UserChip({ user, size = 18 }: { user: OkrUserLite | null; size?: number }) {
  const { t } = useT();
  if (!user) return <span className="text-neutral-300 dark:text-neutral-700 text-xs">{t("okr.unassigned")}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 min-w-0">
      <span
        className="rounded-full flex items-center justify-center text-white font-medium shrink-0"
        style={{ backgroundColor: user.avatarColor, width: size, height: size, fontSize: size * 0.45 }}
      >
        {initials(user.name)}
      </span>
      <span className="truncate">{user.name}</span>
    </span>
  );
}

export function UserStack({ users, size = 18 }: { users: OkrUserLite[]; size?: number }) {
  if (!users.length) return null;
  return (
    <div className="flex items-center -space-x-1.5">
      {users.slice(0, 4).map((u) => (
        <span
          key={u.id}
          className="rounded-full flex items-center justify-center text-white font-medium shrink-0 ring-2 ring-white dark:ring-neutral-900"
          style={{ backgroundColor: u.avatarColor, width: size, height: size, fontSize: size * 0.45 }}
          title={u.name}
        >
          {initials(u.name)}
        </span>
      ))}
      {users.length > 4 && <span className="text-[10px] text-neutral-400 pl-2">+{users.length - 4}</span>}
    </div>
  );
}

export function DeadlineLabel({ endDate }: { endDate: string | null }) {
  const [now] = useState(() => Date.now());
  const { t } = useT();
  if (!endDate) return <span className="text-xs text-neutral-300 dark:text-neutral-700">{t("okr.noDeadline")}</span>;
  const days = Math.ceil((new Date(endDate).getTime() - now) / 86400000);
  const overdue = days < 0;
  const soon = days >= 0 && days <= 7;
  return (
    <span className={cn("text-xs shrink-0", overdue ? "text-red-600 dark:text-red-400 font-medium" : soon ? "text-amber-600 dark:text-amber-500 font-medium" : "text-neutral-500")}>
      {overdue ? t("okr.overdue", { days: Math.abs(days) }) : days === 0 ? t("okr.dueToday") : t("okr.daysLeft", { days })}
    </span>
  );
}

export function CycleLabel({ cycleType, cycleLabel }: { cycleType: string; cycleLabel: string | null }) {
  const { t } = useT();
  return <span className="text-[11px] text-neutral-400 uppercase tracking-wide shrink-0">{cycleLabel || t(`okr.cycle.${cycleType}` as MessageKey)}</span>;
}
