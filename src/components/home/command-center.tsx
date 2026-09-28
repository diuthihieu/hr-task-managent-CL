"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlarmClock, CalendarClock, CheckCircle2, ClipboardList, Hourglass, Loader, Lock, Play, CalendarPlus, Check, Sun, Sparkles, ShieldAlert, ListTodo, CircleDashed, Target, CircleCheck } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { StartFocusButton } from "@/components/focus/focus-mode";
import { AiActionMenu } from "@/components/ai/ai-actions";
import { ProjectIcon } from "@/components/projects/project-icon";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";

export interface HomeTask {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  projectColor: string;
  projectIcon: string | null;
  statusName: string;
  statusColor: string;
  category: "todo" | "in_progress" | "done" | "cancelled";
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  estimateMinutes: number | null;
  actualMinutes: number | null;
  /** Open tasks this one waits on (finish-to-start dependencies). */
  blockedBy: string[];
  completedAt: string | null;
  okr: boolean;
  /** Other people doing it (for "Waiting for others"). */
  assigneeNames: string[];
}

/** Tick before a task, in the accent colour: outline while open, filled when done. */
function TaskTick({ done, title }: { done: boolean; title?: string }) {
  return (
    <span className="shrink-0 inline-flex" title={title}>
      <CircleCheck size={15} className={done ? "fill-indigo-600 text-white dark:fill-indigo-500 dark:text-neutral-900" : "text-indigo-500 dark:text-indigo-400"} aria-hidden />
    </span>
  );
}

/** Card header band that stands out from the card body in light and dark themes. */
function SectionHeader({ icon: Icon, title, count }: { icon: typeof ClipboardList; title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 mb-1 bg-indigo-600 dark:bg-indigo-500/90 text-white">
      <span className="h-6 w-6 rounded-md bg-white/20 flex items-center justify-center shrink-0">
        <Icon size={14} className="text-white" />
      </span>
      <h2 className="font-semibold text-sm flex-1">{title}</h2>
      <span className="text-xs tabular-nums font-medium rounded-full bg-white/20 px-2 py-0.5">{count}</span>
    </div>
  );
}

export type TaskFilter = "open" | "today" | "in_progress" | "overdue" | "due_soon" | "blocked" | "unplanned" | "done";
const FILTERS: TaskFilter[] = ["open", "today", "in_progress", "overdue", "due_soon", "blocked", "unplanned", "done"];

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_STYLE: Record<string, string> = {
  critical: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  high: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  medium: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
};

/** Classifies a task relative to "today" (YYYY-MM-DD, the viewer's server day). */
export function classify(task: HomeTask, today: string, soon: string) {
  const open = task.category === "todo" || task.category === "in_progress";
  return {
    open,
    overdue: open && !!task.dueDate && task.dueDate < today,
    dueToday: open && task.dueDate === today,
    dueSoon: open && !!task.dueDate && task.dueDate > today && task.dueDate <= soon,
    startedToday: open && !!task.startDate && task.startDate <= today,
    blocked: open && task.blockedBy.length > 0,
    unplanned: open && !task.dueDate && !task.startDate,
  };
}

function matches(f: TaskFilter, task: HomeTask, today: string, soon: string) {
  const c = classify(task, today, soon);
  switch (f) {
    case "open":
      return c.open;
    case "today":
      return c.overdue || c.dueToday || (c.startedToday && !c.blocked) || task.category === "in_progress";
    case "in_progress":
      return task.category === "in_progress";
    case "overdue":
      return c.overdue;
    case "due_soon":
      return c.dueSoon || c.dueToday;
    case "blocked":
      return c.blocked;
    case "unplanned":
      return c.unplanned;
    case "done":
      return task.category === "done";
  }
}

/** Focus order: overdue, due today, in progress, priority, due date. */
function focusScore(task: HomeTask, today: string, soon: string) {
  const c = classify(task, today, soon);
  return (c.blocked ? 100 : 0) + (c.overdue ? 0 : c.dueToday ? 10 : task.category === "in_progress" ? 20 : c.dueSoon ? 30 : 40) + (PRIORITY_RANK[task.priority] ?? 2);
}

export function CommandCenter({
  workspaceId,
  base,
  today,
  soon,
  locale,
  tasks: initialTasks,
  waiting,
  doneLast30,
}: {
  workspaceId: string;
  base: string;
  today: string;
  soon: string;
  locale: string;
  tasks: HomeTask[];
  waiting: HomeTask[];
  doneLast30: number;
}) {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [tasks, setTasks] = useState(initialTasks);
  const param = params.get("tasks") as TaskFilter | null;
  const [filter, setFilter] = useState<TaskFilter>(param && FILTERS.includes(param) ? param : "open");
  const [busy, setBusy] = useState<string | null>(null);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, tasks.filter((x) => matches(f, x, today, soon)).length])) as Record<TaskFilter, number>, [tasks, today, soon]);
  const byFocus = (a: HomeTask, b: HomeTask) => focusScore(a, today, soon) - focusScore(b, today, soon) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  const myDay = tasks.filter((x) => matches("today", x, today, soon) && !x.blockedBy.length).sort(byFocus);
  const attention = tasks
    .filter((x) => {
      const c = classify(x, today, soon);
      return c.overdue || c.dueSoon || c.blocked || c.unplanned;
    })
    .sort(byFocus);
  const completed = useMemo(() => tasks.filter((x) => x.category === "done").sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")), [tasks]);
  const focus = myDay[0] ?? tasks.filter((x) => classify(x, today, soon).open && !x.blockedBy.length).sort(byFocus)[0];
  const list = tasks.filter((x) => matches(filter, x, today, soon)).sort(filter === "done" ? () => 0 : byFocus);

  const dateFmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  const hours = (m: number | null) => (m ? `${Math.round((m / 60) * 10) / 10}h` : "—");

  function pick(f: TaskFilter) {
    setFilter(f);
    const next = new URLSearchParams(params.toString());
    next.set("tasks", f);
    router.replace(`?${next.toString()}#my-tasks`, { scroll: false });
    document.getElementById("my-tasks")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function quick(task: HomeTask, action: "complete" | "start" | "plan") {
    setBusy(task.id + action);
    try {
      await api.post(`/api/tasks/${task.id}/quick`, { action });
      setTasks((prev) =>
        prev.map((x) =>
          x.id !== task.id
            ? x
            : action === "complete"
              ? { ...x, category: "done", progress: 100, completedAt: new Date().toISOString() }
              : action === "start"
                ? { ...x, category: "in_progress" }
                : { ...x, startDate: today }
        )
      );
      toast.success(t(`cc.done.${action}` as MessageKey));
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  const card = "rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.03)]";
  const kpis: { f: TaskFilter; label: string; value: number; icon: typeof ClipboardList; tone: string; alert?: boolean }[] = [
    { f: "open", label: t("home.kpi.open"), value: counts.open, icon: ClipboardList, tone: "bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-300" },
    { f: "in_progress", label: t("home.kpi.inProgress"), value: counts.in_progress, icon: Loader, tone: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300" },
    { f: "done", label: t("home.kpi.done"), value: doneLast30, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300" },
    { f: "overdue", label: t("home.kpi.overdue"), value: counts.overdue, icon: AlarmClock, tone: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300", alert: counts.overdue > 0 },
  ];

  const row = (task: HomeTask, compact?: boolean) => {
    const c = classify(task, today, soon);
    return (
      <div key={task.id} className="group flex items-center gap-2 px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/40" data-testid="cc-task">
        <TaskTick done={task.category === "done"} title={task.statusName} />
        <Link href={`${base}/p/${task.projectId}/t/${task.id}`} className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm font-medium hover:text-indigo-600", task.category === "done" ? "text-neutral-400 line-through" : "text-neutral-800 dark:text-neutral-100")}>{task.title || t("common.untitled")}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-neutral-400 truncate">
            <ProjectIcon icon={task.projectIcon} size={11} />
            {task.projectName}
            {c.blocked && (
              <span className="inline-flex items-center gap-0.5 text-amber-600" title={task.blockedBy.join(", ")}>
                · <Lock size={10} /> {t("cc.blockedBy", { name: task.blockedBy[0] })}
              </span>
            )}
            {c.unplanned && <span className="text-neutral-400">· {t("cc.tag.unplanned")}</span>}
            {!compact && task.assigneeNames.length > 0 && <span>· {task.assigneeNames.join(", ")}</span>}
          </span>
        </Link>
        {task.okr && <Target size={12} className="text-indigo-500 shrink-0" aria-label="OKR" />}
        {task.dueDate && <span className={cn("text-[11px] whitespace-nowrap shrink-0", c.overdue ? "text-red-600 font-medium" : c.dueToday ? "text-amber-600 font-medium" : "text-neutral-500")}>{dateFmt(task.dueDate)}</span>}
        {c.open && (
          <span className="hidden group-hover:flex [@media(hover:none)]:flex items-center gap-0.5 shrink-0">
            {task.category === "todo" && (
              <button onClick={() => quick(task, "start")} disabled={!!busy} className="p-1 rounded text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950" title={t("cc.start")} data-testid="cc-start">
                <Play size={13} />
              </button>
            )}
            {!task.startDate && (
              <button onClick={() => quick(task, "plan")} disabled={!!busy} className="p-1 rounded text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950" title={t("cc.plan")} data-testid="cc-plan">
                <CalendarPlus size={13} />
              </button>
            )}
            <button onClick={() => quick(task, "complete")} disabled={!!busy} className="p-1 rounded text-neutral-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950" title={t("cc.complete")} data-testid="cc-complete">
              <Check size={13} />
            </button>
          </span>
        )}
      </div>
    );
  };

  const section = ({ title, icon: Icon, items, empty, testId, more }: { title: string; icon: typeof ClipboardList; items: HomeTask[]; empty: string; testId: string; more?: TaskFilter }) => (
    <section className={cn(card, "flex flex-col overflow-hidden")} data-testid={testId}>
      <SectionHeader icon={Icon} title={title} count={items.length} />
      <div className="max-h-72 overflow-y-auto thin-scroll divide-y divide-neutral-100 dark:divide-neutral-800 flex-1">
        {items.length === 0 ? <p className="px-4 pb-4 pt-1 text-xs text-neutral-400">{empty}</p> : items.slice(0, 30).map((x) => row(x, true))}
      </div>
      {more && items.length > 0 && (
        <button onClick={() => pick(more)} className="text-xs font-medium text-indigo-600 hover:underline px-4 py-2 text-left border-t border-neutral-100 dark:border-neutral-800">
          {t("home.viewAll")}
        </button>
      )}
    </section>
  );

  const attentionCounts = [
    { f: "overdue" as const, n: counts.overdue, tone: "text-red-600 bg-red-50 dark:bg-red-950" },
    { f: "due_soon" as const, n: counts.due_soon, tone: "text-amber-700 bg-amber-50 dark:bg-amber-950" },
    { f: "blocked" as const, n: counts.blocked, tone: "text-orange-700 bg-orange-50 dark:bg-orange-950" },
    { f: "unplanned" as const, n: counts.unplanned, tone: "text-neutral-600 bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-300" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="home-kpis">
        {kpis.map((k) => (
          <button key={k.f} onClick={() => pick(k.f)} className={cn(card, "p-4 flex items-center gap-3 text-left hover:border-indigo-200 dark:hover:border-indigo-900 transition-colors", filter === k.f && "ring-2 ring-indigo-500/40")} data-testid={`kpi-${k.f}`}>
            <span className={cn("h-11 w-11 rounded-xl flex items-center justify-center shrink-0", k.tone)}>
              <k.icon size={20} />
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-neutral-500 truncate">{k.label}</span>
              <span className={cn("block text-2xl font-bold tabular-nums", k.alert ? "text-red-600" : "text-neutral-900 dark:text-neutral-50")}>{k.value}</span>
            </span>
          </button>
        ))}
      </div>

      <section className={cn(card, "p-4 flex flex-wrap items-center gap-4 bg-gradient-to-r from-indigo-50/70 to-transparent dark:from-indigo-950/40")} data-testid="cc-focus">
        <span className="h-11 w-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
          <Sun size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">{t("cc.focusToday")}</div>
          {focus ? (
            <>
              <Link href={`${base}/p/${focus.projectId}/t/${focus.id}`} className="block truncate text-base font-semibold text-neutral-900 dark:text-neutral-50 hover:text-indigo-600">
                {focus.title}
              </Link>
              <div className="text-xs text-neutral-500 truncate">
                {focus.projectName}
                {focus.dueDate && ` · ${t("home.col.due")} ${dateFmt(focus.dueDate)}`}
                {` · ${t("cc.estimate")} ${hours(focus.estimateMinutes)} · ${t("cc.actual")} ${hours(focus.actualMinutes)}`}
              </div>
            </>
          ) : (
            <div className="text-sm text-neutral-500">{t("cc.focusEmpty")}</div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {focus && <StartFocusButton taskId={focus.id} />}
          <AiActionMenu
            targetId={workspaceId}
            autoAction={params.get("ai")}
            label={t("cc.aiBrief")}
            actions={[
              { action: "home_brief", label: "cc.ai.brief", icon: Sparkles },
              { action: "home_plan", label: "cc.ai.plan", icon: CalendarClock },
              { action: "home_risks", label: "cc.ai.risks", icon: ShieldAlert },
            ]}
          />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {section({ title: t("cc.myDay"), icon: Sun, items: myDay, empty: t("cc.myDayEmpty"), testId: "cc-myday", more: "today" })}
        <section className={cn(card, "flex flex-col overflow-hidden")} data-testid="cc-attention">
          <SectionHeader icon={AlarmClock} title={t("cc.attention")} count={attention.length} />
          <div className="flex flex-wrap gap-1 px-4 pb-2">
            {attentionCounts.map((a) => (
              <button key={a.f} onClick={() => pick(a.f)} className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", a.tone)} data-testid={`cc-chip-${a.f}`}>
                {t(`cc.filter.${a.f}` as MessageKey)} {a.n}
              </button>
            ))}
          </div>
          <div className="max-h-64 overflow-y-auto thin-scroll divide-y divide-neutral-100 dark:divide-neutral-800 flex-1">
            {attention.length === 0 ? <p className="px-4 pb-4 text-xs text-neutral-400">{t("cc.attentionEmpty")}</p> : attention.slice(0, 30).map((x) => row(x, true))}
          </div>
        </section>
        {section({ title: t("cc.waiting"), icon: Hourglass, items: waiting, empty: t("cc.waitingEmpty"), testId: "cc-waiting" })}
        {section({ title: t("cc.completed"), icon: CheckCircle2, items: completed, empty: t("cc.completedEmpty"), testId: "cc-completed", more: "done" })}
      </div>

      <section id="my-tasks" className={cn(card, "overflow-hidden scroll-mt-4")} data-testid="home-my-tasks">
        <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-3">
          <ListTodo size={16} className="text-indigo-600" />
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-50 mr-2">{t("home.myTasks")}</h2>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => pick(f)}
                className={cn("rounded-full px-2.5 py-1 text-xs font-medium border", filter === f ? "bg-indigo-600 border-indigo-600 text-white" : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-indigo-300")}
                data-testid={`cc-filter-${f}`}
              >
                {t(`cc.filter.${f}` as MessageKey)} <span className="tabular-nums opacity-70">{counts[f]}</span>
              </button>
            ))}
          </div>
          <Link href={`${base}/my-work`} className="ml-auto text-xs font-medium text-indigo-600 hover:underline">
            {t("nav.myWork")}
          </Link>
        </div>
        {list.length === 0 ? (
          <div className="px-5 pb-8 pt-4 text-sm text-neutral-400 text-center flex flex-col items-center gap-2">
            <CircleDashed size={22} className="opacity-50" />
            {t("home.noTasks")}
          </div>
        ) : (
          <div className="max-h-[520px] overflow-y-auto thin-scroll border-t border-neutral-100 dark:border-neutral-800" data-testid="cc-list">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-neutral-900 z-10">
                <tr className="text-[11px] uppercase tracking-wide text-neutral-400 border-b border-neutral-100 dark:border-neutral-800">
                  <th className="text-left font-medium px-5 py-2">{t("home.col.task")}</th>
                  <th className="text-left font-medium px-2 py-2 hidden md:table-cell">{t("home.col.project")}</th>
                  <th className="text-left font-medium px-2 py-2">{t("home.col.priority")}</th>
                  <th className="text-left font-medium px-2 py-2">{t("home.col.due")}</th>
                  <th className="text-left font-medium px-2 py-2 hidden lg:table-cell">{t("cc.col.hours")}</th>
                  <th className="text-left font-medium px-2 py-2 hidden xl:table-cell">{t("home.col.progress")}</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {list.map((task) => {
                  const c = classify(task, today, soon);
                  return (
                    <tr key={task.id} className="group border-b last:border-0 border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/40" data-testid="cc-row">
                      <td className="px-5 py-2.5 max-w-0 w-[40%]">
                        <Link href={`${base}/p/${task.projectId}/t/${task.id}`} className="flex items-center gap-2 min-w-0">
                          <TaskTick done={task.category === "done"} title={task.statusName} />
                          <span className={cn("truncate font-medium hover:text-indigo-600", task.category === "done" ? "text-neutral-400 line-through" : "text-neutral-800 dark:text-neutral-100")}>{task.title || t("common.untitled")}</span>
                          {c.blocked && <Lock size={11} className="text-amber-600 shrink-0" aria-label={t("cc.filter.blocked")} />}
                        </Link>
                      </td>
                      <td className="px-2 py-2.5 hidden md:table-cell">
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 max-w-40">
                          <ProjectIcon icon={task.projectIcon} size={12} />
                          <span className="truncate">{task.projectName}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.medium)}>{t(`okr.priority.${task.priority}` as MessageKey)}</span>
                      </td>
                      <td className={cn("px-2 py-2.5 text-xs whitespace-nowrap", c.overdue ? "text-red-600 font-medium" : "text-neutral-500")}>{task.dueDate ? dateFmt(task.dueDate) : "—"}</td>
                      <td className="px-2 py-2.5 text-xs text-neutral-500 whitespace-nowrap hidden lg:table-cell tabular-nums">
                        {hours(task.actualMinutes)} / {hours(task.estimateMinutes)}
                      </td>
                      <td className="px-2 py-2.5 hidden xl:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${task.progress}%` }} />
                          </div>
                          <span className="text-[11px] text-neutral-400 tabular-nums">{task.progress}%</span>
                        </div>
                      </td>
                      <td className="pr-3 py-2.5">
                        {c.open && (
                          <span className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                            {task.category === "todo" && (
                              <button onClick={() => quick(task, "start")} disabled={!!busy} className="p-1 rounded text-neutral-400 hover:text-indigo-600" title={t("cc.start")}>
                                <Play size={13} />
                              </button>
                            )}
                            {!task.startDate && (
                              <button onClick={() => quick(task, "plan")} disabled={!!busy} className="p-1 rounded text-neutral-400 hover:text-indigo-600" title={t("cc.plan")}>
                                <CalendarPlus size={13} />
                              </button>
                            )}
                            <button onClick={() => quick(task, "complete")} disabled={!!busy} className="p-1 rounded text-neutral-400 hover:text-emerald-600" title={t("cc.complete")} data-testid="cc-row-complete">
                              <Check size={13} />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
