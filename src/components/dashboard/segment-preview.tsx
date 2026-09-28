"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AlarmClock, CircleCheck, Filter, ListChecks, Loader2, TrendingUp } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";
import type { Segment, SegmentTask } from "@/lib/dashboard-engine";
import { cn } from "@/lib/utils";

export interface SegmentPreviewState {
  widgetTitle: string;
  segment: Segment;
  tasks: SegmentTask[] | null;
  total: number;
  error?: string;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Drill-down preview for one chart segment: a quick summary of the group
 * (count, done, overdue, average progress, split by status) and the tasks
 * themselves, each opening its record.
 */
export function SegmentPreview({
  state,
  onClose,
  hrefFor,
  onOpenTask,
  onFilter,
}: {
  state: SegmentPreviewState | null;
  onClose: () => void;
  /** Link target for a task (dashboards); or use onOpenTask to open it in place (project report). */
  hrefFor?: (task: SegmentTask) => string;
  onOpenTask?: (task: SegmentTask) => void;
  /** Optional "filter the whole dashboard by this segment" action. */
  onFilter?: () => void;
}) {
  const { t } = useT();
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [source, setSource] = useState(state);
  if (state !== source) {
    setSource(state);
    setStatusFilter(null);
  }

  const tasks = useMemo(() => state?.tasks ?? [], [state]);
  const today = todayIso();
  const isOpen = (x: SegmentTask) => x.status?.category !== "done" && x.status?.category !== "cancelled";
  const summary = useMemo(() => {
    const done = tasks.filter((x) => x.status?.category === "done").length;
    const overdue = tasks.filter((x) => isOpen(x) && x.dueDate && x.dueDate < today).length;
    const withProgress = tasks.filter((x) => x.progress != null);
    const avg = withProgress.length ? Math.round(withProgress.reduce((s, x) => s + (x.progress ?? 0), 0) / withProgress.length) : null;
    const byStatus = new Map<string, { label: string; color?: string; n: number }>();
    for (const x of tasks) {
      const label = x.status?.label ?? "—";
      const cur = byStatus.get(label) ?? { label, color: x.status?.color, n: 0 };
      cur.n++;
      byStatus.set(label, cur);
    }
    return { done, overdue, avg, byStatus: [...byStatus.values()].sort((a, b) => b.n - a.n) };
  }, [tasks, today]);

  const shown = statusFilter ? tasks.filter((x) => (x.status?.label ?? "—") === statusFilter) : tasks;
  const heading = state ? [state.segment.label, state.segment.seriesLabel].filter(Boolean).join(" · ") : "";

  return (
    <Dialog open={!!state} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden flex flex-col" data-testid="segment-preview">
        <div className="px-5 pt-5 pb-3 border-b border-neutral-100 dark:border-neutral-800">
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400 truncate pr-8">{state?.widgetTitle}</p>
          <DialogTitle className="truncate pr-8">{heading}</DialogTitle>
          {state?.tasks && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              <Stat icon={ListChecks} label={t("seg.tasks")} value={String(state.total)} />
              <Stat icon={CircleCheck} label={t("seg.done")} value={tasks.length ? `${summary.done} (${Math.round((summary.done / tasks.length) * 100)}%)` : "0"} />
              <Stat icon={AlarmClock} label={t("seg.overdue")} value={String(summary.overdue)} alert={summary.overdue > 0} />
              <Stat icon={TrendingUp} label={t("seg.avgProgress")} value={summary.avg == null ? "—" : `${summary.avg}%`} />
            </div>
          )}
          {summary.byStatus.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mt-3" data-testid="segment-status-chips">
              <button onClick={() => setStatusFilter(null)} className={cn("rounded-full border px-2.5 py-0.5 text-xs", !statusFilter ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300")}>
                {t("seg.all")} · {tasks.length}
              </button>
              {summary.byStatus.map((s) => (
                <button key={s.label} onClick={() => setStatusFilter(s.label === statusFilter ? null : s.label)} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs", statusFilter === s.label ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300")}>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color ?? "#94a3b8" }} />
                  {s.label} · {s.n}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-y-auto thin-scroll max-h-[55dvh]">
          {!state?.tasks && !state?.error && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-neutral-400">
              <Loader2 size={15} className="animate-spin" /> {t("db.loading")}
            </div>
          )}
          {state?.error && <p className="px-5 py-8 text-sm text-red-500">{state.error}</p>}
          {state?.tasks && shown.length === 0 && <p className="px-5 py-8 text-sm text-neutral-400">{t("seg.empty")}</p>}
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {shown.map((task) => {
              const overdue = isOpen(task) && !!task.dueDate && task.dueDate < today;
              const body = (
                <>
                  <CircleCheck size={15} className={cn("shrink-0", task.status?.category === "done" ? "fill-indigo-600 text-white dark:fill-indigo-500 dark:text-neutral-900" : "text-indigo-500 dark:text-indigo-400")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm font-medium", task.status?.category === "done" ? "text-neutral-400 line-through" : "text-neutral-800 dark:text-neutral-100")}>{task.title || t("common.untitled")}</span>
                    <span className="block truncate text-[11px] text-neutral-400">{task.assignees.length ? task.assignees.join(", ") : t("okr.unassigned")}</span>
                  </span>
                  {task.status && (
                    <span className="hidden sm:inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium shrink-0" style={{ backgroundColor: `${task.status.color ?? "#94a3b8"}22`, color: task.status.color ?? undefined }}>
                      {task.status.label}
                    </span>
                  )}
                  {task.progress != null && <span className="hidden md:block text-[11px] tabular-nums text-neutral-500 w-9 text-right shrink-0">{task.progress}%</span>}
                  <span className={cn("text-[11px] whitespace-nowrap w-20 text-right shrink-0", overdue ? "text-red-600 font-medium" : "text-neutral-500")}>{task.dueDate ?? "—"}</span>
                </>
              );
              const cls = "flex items-center gap-2.5 px-5 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 w-full text-left";
              return (
                <li key={task.id} data-testid="segment-task">
                  {hrefFor ? (
                    <Link href={hrefFor(task)} className={cls} onClick={onClose}>
                      {body}
                    </Link>
                  ) : (
                    <button type="button" className={cls} onClick={() => onOpenTask?.(task)}>
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {state?.tasks && state.total > tasks.length && <p className="px-5 py-2 text-[11px] text-neutral-400">{t("seg.limited", { shown: tasks.length, total: state.total })}</p>}
        </div>

        {onFilter && (
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-neutral-100 dark:border-neutral-800">
            <Button size="sm" variant="secondary" onClick={onFilter} data-testid="segment-filter">
              <Filter size={13} /> {t("seg.filterDashboard")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ icon: Icon, label, value, alert }: { icon: typeof ListChecks; label: string; value: string; alert?: boolean }) {
  return (
    <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[11px] text-neutral-500">
        <Icon size={12} className={alert ? "text-red-500" : "text-indigo-500"} /> {label}
      </div>
      <div className={cn("text-sm font-semibold tabular-nums mt-0.5", alert ? "text-red-600" : "text-neutral-900 dark:text-neutral-50")}>{value}</div>
    </div>
  );
}
